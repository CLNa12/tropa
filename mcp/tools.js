// Инструменты MCP — ровно список из раздела 7 PRD плюс ping для диагностики.
// Каждый инструмент — тонкая обёртка над ручкой API: своей логики здесь нет.
//
// Два правила раздела 7 заложены в код, а не в уговор:
//   1. координат x/y нет ни во входных данных, ни в компактных ответах — раскладку агент не трогает;
//   2. get_roadmap и search_tasks отдают только заголовки, статусы и связи; подробности — get_task.
import { z } from 'zod';
import { api, ready, seg } from './api.js';

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];

const roadmapId = z.string().describe('id карты, например rm_3f9a21c4');
const taskId = z.string().describe('id задачи, например tk_7b1c0d2e');
const version = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    'номер версии задачи из get_task. Пришлите его, чтобы запись отклонилась, если задачу правили параллельно',
  );

/** Из компактного ответа убираем x/y: агенту они не нужны и менять их нельзя. */
const withoutPosition = ({ x, y, ...rest }) => rest;

export const tools = [
  // ------------------------------------------------------------------ диагностика
  {
    name: 'ping',
    title: 'Ping',
    description:
      'Проверка связи с MCP-сервером Tropa. Возвращает "pong", время, версию и то, как сервер подключён к API.',
    input: {},
    async run() {
      const { base, mode, port } = await ready();
      const now = new Date();
      return {
        reply: 'pong',
        time: now.toLocaleString('ru-RU'),
        iso: now.toISOString(),
        server: 'tropa 0.2.0',
        pid: process.pid,
        api: { mode, port, base },
        apiHealth: await api('GET', '/health'),
      };
    },
  },

  // ------------------------------------------------------------------ чтение
  {
    name: 'list_roadmaps',
    title: 'Список карт',
    description: 'Все карты с прогрессом (сколько задач закрыто из общего числа). Начинайте с этого.',
    input: {},
    run: () => api('GET', '/roadmaps'),
  },
  {
    name: 'get_roadmap',
    title: 'Карта целиком',
    description:
      'Одна карта компактно: этапы, задачи и связи между ними — только заголовки, статусы, прогресс и зависимости. ' +
      'Описаний, критериев приёмки и заметок здесь нет: за ними идите в get_task. Так карта не съедает контекст.',
    input: {
      id: roadmapId,
      includeContext: z
        .boolean()
        .default(false)
        .describe('включить вводные карты (поле context) — бывают длинными, поэтому по умолчанию выключено'),
    },
    async run({ id, includeContext }) {
      const data = await api('GET', `/roadmaps/${seg(id)}`);
      const { context, ...head } = data.roadmap;
      return {
        roadmap: includeContext
          ? { ...head, context }
          : { ...head, contextChars: context.length },
        stages: data.stages,
        tasks: data.tasks.map(withoutPosition),
      };
    },
  },
  {
    name: 'get_task',
    title: 'Задача подробно',
    description:
      'Одна задача со всеми полями: описание, критерии приёмки, файлы, подзадачи, лента заметок, ' +
      'что её блокирует и что блокирует она. Здесь же номер версии для безопасной правки.',
    input: { id: roadmapId, taskId },
    async run({ id, taskId }) {
      const task = await api('GET', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}`);
      return withoutPosition(task);
    },
  },
  {
    name: 'get_next_task',
    title: 'Следующая задача',
    description:
      'Главный инструмент: первая задача, у которой все зависимости закрыты. ' +
      'С него начинайте сессию. Если свободных задач нет — вернёт список заблокированных и чем они держатся.',
    input: { id: roadmapId },
    async run({ id }) {
      const data = await api('GET', `/roadmaps/${seg(id)}/next-task`);
      return data.task ? { ...data, task: withoutPosition(data.task) } : data;
    },
  },
  {
    name: 'search_tasks',
    title: 'Поиск задач',
    description:
      'Поиск по тексту (заголовок и описание), статусу или пути файла. ' +
      'Отдаёт только id, заголовок и статус — подробности через get_task.',
    input: {
      id: roadmapId,
      query: z.string().default('').describe('подстрока в заголовке или описании'),
      status: z.enum(STATUSES).optional().describe('оставить только задачи с этим статусом'),
      file: z.string().default('').describe('подстрока пути из поля files'),
    },
    run({ id, query, status, file }) {
      const qs = new URLSearchParams({ q: query ?? '', status: status ?? '', file: file ?? '' });
      return api('GET', `/roadmaps/${seg(id)}/search?${qs}`);
    },
  },

  // ------------------------------------------------------------------ создание
  {
    name: 'create_roadmap',
    title: 'Новая карта',
    description:
      'Создать карту: название, цель (одна фраза — что считается «сделано» для всей карты) и вводные. ' +
      'Этапы и задачи добавляются потом через bulk_create или create_stage/create_task.',
    input: {
      title: z.string().describe('название карты'),
      goal: z.string().default('').describe('одна фраза: что считается «сделано» для всей карты'),
      context: z.string().default('').describe('вводные: ограничения, ссылки на материалы'),
    },
    run: (args) => api('POST', '/roadmaps', args),
  },
  {
    name: 'bulk_create',
    title: 'Дерево за один вызов',
    description:
      'Добавить сразу несколько этапов с задачами и подзадачами. Потолок — 40 задач за вызов и 20 этапов. ' +
      'Дробите задачи до объёма примерно полдня работы, не плодите мелочь вроде «открыть файл». ' +
      'Связи между задачами тут не задаются — добавьте их после через link_tasks.',
    input: {
      id: roadmapId,
      stages: z
        .array(
          z.object({
            title: z.string().describe('название этапа'),
            color: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .optional()
              .describe('цвет группы нод, формат #rrggbb'),
            tasks: z
              .array(
                z.object({
                  title: z.string(),
                  description: z.string().default('').describe('что именно сделать, markdown'),
                  status: z.enum(STATUSES).default('todo'),
                  acceptance: z
                    .array(z.string())
                    .default([])
                    .describe('критерии приёмки: по ним видно, когда задачу закрывать'),
                  files: z.array(z.string()).default([]).describe('какие файлы затрагивает, необязательно'),
                  estimate: z.number().nullable().default(null).describe('оценка в часах, необязательно'),
                  subtasks: z.array(z.string()).default([]).describe('чеклист внутри задачи: только заголовки'),
                }),
              )
              .default([]),
          }),
        )
        .describe('этапы с задачами'),
    },
    run: ({ id, stages }) => api('POST', `/roadmaps/${seg(id)}/bulk`, { stages }),
  },
  {
    name: 'create_stage',
    title: 'Новый этап',
    description: 'Добавить один этап в карту.',
    input: {
      id: roadmapId,
      title: z.string(),
      order: z.number().int().min(0).optional().describe('порядок в сайдбаре; по умолчанию в конец'),
      dependsOn: z.array(z.string()).default([]).describe('id этапов, без которых этот не начать'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('цвет группы нод, формат #rrggbb'),
    },
    run: ({ id, ...body }) => api('POST', `/roadmaps/${seg(id)}/stages`, body),
  },
  {
    name: 'create_task',
    title: 'Новая задача',
    description:
      'Добавить одну задачу в этап. Положение на канвасе задать нельзя — его ставит автораскладка или пользователь.',
    input: {
      id: roadmapId,
      stageId: z.string().describe('id этапа, в который кладём задачу'),
      title: z.string(),
      description: z.string().default('').describe('что именно сделать, markdown'),
      status: z.enum(STATUSES).default('todo'),
      acceptance: z.array(z.string()).default([]).describe('критерии приёмки'),
      files: z.array(z.string()).default([]).describe('какие файлы затрагивает, необязательно'),
      dependsOn: z.array(z.string()).default([]).describe('id задач, без которых эту не начать'),
      estimate: z.number().nullable().default(null).describe('оценка в часах, необязательно'),
    },
    async run({ id, ...body }) {
      return withoutPosition(await api('POST', `/roadmaps/${seg(id)}/tasks`, body));
    },
  },
  {
    name: 'create_subtask',
    title: 'Новая подзадача',
    description: 'Добавить пункт в чеклист задачи.',
    input: {
      id: roadmapId,
      taskId,
      title: z.string(),
      done: z.boolean().default(false),
      order: z.number().int().min(0).optional().describe('порядок в чеклисте; по умолчанию в конец'),
    },
    run: ({ id, taskId, ...body }) =>
      api('POST', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/subtasks`, body),
  },

  // ------------------------------------------------------------------ правка
  {
    name: 'update_roadmap',
    title: 'Правка карты',
    description:
      'Изменить название, цель или вводные карты, а также убрать её в архив. ' +
      'Присылайте только те поля, которые меняете — остальные останутся как были. ' +
      'Цель карты по ходу работы уточняется: это нормально, для этого инструмент и нужен.',
    input: {
      id: roadmapId,
      title: z.string().optional().describe('новое название карты'),
      goal: z.string().optional().describe('одна фраза: что считается «сделано» для всей карты'),
      context: z.string().optional().describe('вводные: ограничения, ссылки на материалы'),
      archived: z.boolean().optional().describe('true — убрать карту из активных в архив'),
    },
    run({ id, ...patch }) {
      for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
      if (Object.keys(patch).length === 0) throw new Error('нечего менять: укажите хотя бы одно поле');
      return api('PATCH', `/roadmaps/${seg(id)}`, patch);
    },
  },
  {
    name: 'update_stage',
    title: 'Правка этапа',
    description:
      'Переименовать этап, перекрасить его или изменить порядок и зависимости. ' +
      'Задачи внутри этапа при этом сохраняются — удалять и создавать этап заново не нужно. ' +
      'Присылайте только те поля, которые меняете.',
    input: {
      id: roadmapId,
      stageId: z.string().describe('id этапа, например st_5c6d7e8f'),
      title: z.string().optional().describe('новое название этапа'),
      order: z.number().int().min(0).optional().describe('порядок в сайдбаре'),
      dependsOn: z.array(z.string()).optional().describe('id этапов, без которых этот не начать'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('цвет группы нод, формат #rrggbb'),
    },
    run({ id, stageId, ...patch }) {
      for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
      if (Object.keys(patch).length === 0) throw new Error('нечего менять: укажите хотя бы одно поле');
      return api('PATCH', `/roadmaps/${seg(id)}/stages/${seg(stageId)}`, patch);
    },
  },
  {
    name: 'update_task',
    title: 'Правка задачи',
    description:
      'Изменить поля задачи: заголовок, описание, критерии приёмки, файлы, оценку, этап. ' +
      'Статус меняется через set_status, связи — через link_tasks, координаты не меняются вовсе. ' +
      'Передавайте version из get_task, чтобы не затереть правку пользователя.',
    input: {
      id: roadmapId,
      taskId,
      title: z.string().optional(),
      description: z.string().optional(),
      acceptance: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      estimate: z.number().nullable().optional(),
      stageId: z.string().optional().describe('перенести задачу в другой этап'),
      version,
    },
    async run({ id, taskId, ...patch }) {
      for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
      if (Object.keys(patch).filter((k) => k !== 'version').length === 0) {
        throw new Error('нечего менять: укажите хотя бы одно поле');
      }
      return withoutPosition(await api('PATCH', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}`, patch));
    },
  },
  {
    name: 'set_status',
    title: 'Смена статуса',
    description:
      'Поставить задаче статус todo / in_progress / blocked / done. ' +
      'Для blocked причина обязательна — она попадёт в ленту заметок. ' +
      'Этим инструментом заканчивается работа над задачей.',
    input: {
      id: roadmapId,
      taskId,
      status: z.enum(STATUSES),
      reason: z
        .string()
        .optional()
        .describe('для blocked обязательно: чем именно заблокировано. Для остальных статусов — короткий комментарий'),
      version,
    },
    async run({ id, taskId, ...body }) {
      for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
      return withoutPosition(await api('POST', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/status`, body));
    },
  },
  {
    name: 'toggle_subtask',
    title: 'Галочка в чеклисте',
    description: 'Отметить подзадачу выполненной или снять галочку. Без поля done — переключает.',
    input: {
      id: roadmapId,
      taskId,
      subtaskId: z.string().describe('id подзадачи, например sb_1a2b3c4d'),
      done: z.boolean().optional().describe('true/false; если не указать — переключит на противоположное'),
    },
    run: ({ id, taskId, subtaskId, done }) =>
      api('PATCH', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/subtasks/${seg(subtaskId)}`, { done }),
  },
  {
    name: 'add_note',
    title: 'Заметка в задачу',
    description:
      'Дописать в ленту задачи, что реально сделано или на чём застряли. Видно, где писал агент, а где человек. ' +
      'Пишите сюда всё, что всплыло по ходу работы — это внешняя память проекта.',
    input: {
      id: roadmapId,
      taskId,
      text: z.string().describe('текст заметки'),
      author: z.enum(['agent', 'human']).default('agent').describe('кто пишет; агенту оставляйте agent'),
    },
    run: ({ id, taskId, ...body }) =>
      api('POST', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/notes`, body),
  },

  // ------------------------------------------------------------------ связи
  {
    name: 'link_tasks',
    title: 'Связать задачи',
    description:
      'Сказать, что задача taskId не начинается без задачи dependsOn. Круговые зависимости отклоняются.',
    input: {
      id: roadmapId,
      taskId: taskId.describe('id задачи, которая зависит'),
      dependsOn: z.string().describe('id задачи, от которой зависит'),
    },
    run: ({ id, taskId, dependsOn }) =>
      api('POST', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/links`, { dependsOn }),
  },
  {
    name: 'unlink_tasks',
    title: 'Убрать связь',
    description: 'Снять зависимость задачи taskId от задачи dependsOn.',
    input: {
      id: roadmapId,
      taskId: taskId.describe('id задачи, которая зависит'),
      dependsOn: z.string().describe('id задачи, от которой зависимость снимаем'),
    },
    run: ({ id, taskId, dependsOn }) =>
      api('DELETE', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/links/${seg(dependsOn)}`),
  },

  // ------------------------------------------------------------------ удаление
  {
    name: 'delete_roadmap',
    title: 'Удалить карту',
    description:
      'Удалить карту целиком вместе со всеми этапами и задачами. Требует confirm=true. ' +
      'Перед удалением делается автокопия, но спросите пользователя — сам не решайте.',
    input: { id: roadmapId, confirm: z.boolean().describe('только true; подтверждение пользователя обязательно') },
    run: ({ id, confirm }) => api('DELETE', `/roadmaps/${seg(id)}?confirm=${confirm === true}`),
  },
  {
    name: 'delete_stage',
    title: 'Удалить этап',
    description:
      'Удалить этап и все задачи внутри него. Требует confirm=true. Спросите пользователя перед вызовом.',
    input: {
      id: roadmapId,
      stageId: z.string().describe('id этапа, например st_5c6d7e8f'),
      confirm: z.boolean().describe('только true; подтверждение пользователя обязательно'),
    },
    run: ({ id, stageId, confirm }) =>
      api('DELETE', `/roadmaps/${seg(id)}/stages/${seg(stageId)}?confirm=${confirm === true}`),
  },
  {
    name: 'delete_task',
    title: 'Удалить задачу',
    description:
      'Удалить задачу и ссылки на неё из зависимостей других задач. Требует confirm=true. ' +
      'Если задача просто не нужна — чаще правильнее set_status, а не удаление.',
    input: {
      id: roadmapId,
      taskId,
      confirm: z.boolean().describe('только true; подтверждение пользователя обязательно'),
    },
    run: ({ id, taskId, confirm }) =>
      api('DELETE', `/roadmaps/${seg(id)}/tasks/${seg(taskId)}?confirm=${confirm === true}`),
  },
  {
    name: 'delete_note',
    title: 'Удалить заметку',
    description:
      'Убрать запись из ленты задачи — например служебную, оставленную по ошибке. Требует confirm=true.',
    input: {
      id: roadmapId,
      taskId,
      noteId: z.string().describe('id заметки'),
      confirm: z.boolean().describe('только true; подтверждение пользователя обязательно'),
    },
    run: ({ id, taskId, noteId, confirm }) =>
      api(
        'DELETE',
        `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/notes/${seg(noteId)}?confirm=${confirm === true}`,
      ),
  },
  {
    name: 'delete_subtask',
    title: 'Удалить подзадачу',
    description: 'Удалить пункт чеклиста. Требует confirm=true.',
    input: {
      id: roadmapId,
      taskId,
      subtaskId: z.string().describe('id подзадачи'),
      confirm: z.boolean().describe('только true; подтверждение пользователя обязательно'),
    },
    run: ({ id, taskId, subtaskId, confirm }) =>
      api(
        'DELETE',
        `/roadmaps/${seg(id)}/tasks/${seg(taskId)}/subtasks/${seg(subtaskId)}?confirm=${confirm === true}`,
      ),
  },
];

// Сквозная проверка этапа 2: поднимает MCP-сервер как настоящий дочерний процесс по stdio
// и проходит все инструменты раздела 7 — как это делал бы Claude.
// Работает на временной папке, настоящие карты в ~/.tropa не трогает. Запуск: npm run mcp:check
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'tropa-mcp-'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, '..', 'mcp', 'server.js')],
  env: {
    ...process.env,
    TROPA_HOME: sandbox, // карты пишутся в песочницу
    TROPA_PORT: '0', // снаружи сервера нет → MCP поднимет API внутри себя
  },
  stderr: 'pipe',
});

const client = new Client({ name: 'tropa-mcp-check', version: '0.2.0' });
await client.connect(transport);

let passed = 0;
const failures = [];

function check(name, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${details ? ` — ${details}` : ''}`);
  }
}

/** Успешный вызов: падает, если инструмент вернул ошибку. */
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  if (res.isError) throw new Error(`${name} вернул ошибку: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Ожидаемая ошибка: возвращает её текст. */
async function expectError(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  if (!res.isError) throw new Error(`${name} должен был вернуть ошибку, но прошёл`);
  return res.content?.[0]?.text ?? '';
}

try {
  // --- список инструментов ---
  const expected = [
    'ping',
    'list_roadmaps',
    'get_roadmap',
    'get_task',
    'get_next_task',
    'search_tasks',
    'create_roadmap',
    'bulk_create',
    'create_stage',
    'create_task',
    'create_subtask',
    'update_roadmap',
    'update_stage',
    'update_task',
    'set_status',
    'toggle_subtask',
    'add_note',
    'link_tasks',
    'unlink_tasks',
    'delete_roadmap',
    'delete_stage',
    'delete_task',
    'delete_subtask',
    'delete_note',
  ];
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  console.log(`\nинструменты (${names.length}): ${names.join(', ')}\n`);
  check('все инструменты раздела 7 на месте', expected.every((n) => names.includes(n)));
  check('лишних инструментов нет', names.length === expected.length, names.join(','));
  check(
    'у каждого инструмента есть описание',
    tools.every((t) => (t.description ?? '').length > 20),
  );
  check(
    'set_position не выставлен наружу',
    !names.some((n) => n.includes('position')),
  );

  // --- диагностика ---
  const pong = await call('ping');
  check('ping отвечает pong', pong.reply === 'pong', JSON.stringify(pong));
  check('ping видит API', pong.apiHealth?.ok === true);
  check('API поднят внутри процесса MCP', pong.api?.mode === 'embedded', pong.api?.mode);
  check('карты пишутся в песочницу', pong.apiHealth?.storage === sandbox, pong.apiHealth?.storage);

  // --- создание карты ---
  const rm = await call('create_roadmap', {
    title: 'Проверка этапа 2',
    goal: 'MCP умеет всё из раздела 7',
    context: 'x'.repeat(500),
  });
  check('create_roadmap вернул id', /^rm_[a-z0-9]{8}$/.test(rm.id ?? ''), JSON.stringify(rm));
  const id = rm.id;

  const list = await call('list_roadmaps');
  check('list_roadmaps видит новую карту', list.roadmaps.some((r) => r.id === id));
  check(
    'list_roadmaps отдаёт прогресс',
    list.roadmaps.find((r) => r.id === id)?.progress?.total === 0,
  );

  // --- дерево за один вызов ---
  const bulk = await call('bulk_create', {
    id,
    stages: [
      {
        title: 'Этап A',
        color: '#4f46e5',
        tasks: [
          {
            title: 'Задача A1',
            description: 'подробное описание, которого не должно быть в get_roadmap',
            acceptance: ['критерий 1'],
            files: ['server/api.js'],
            subtasks: ['шаг 1', 'шаг 2'],
          },
          { title: 'Задача A2', description: 'вторая' },
        ],
      },
      { title: 'Этап B', tasks: [{ title: 'Задача B1', estimate: 3 }] },
    ],
  });
  check('bulk_create создал 2 этапа', bulk.stages.length === 2);
  check('bulk_create создал 3 задачи', bulk.tasks.length === 3);
  check('bulk_create создал 2 подзадачи', bulk.subtasks === 2);

  const tooMany = await expectError('bulk_create', {
    id,
    stages: [{ title: 'Перебор', tasks: Array.from({ length: 41 }, (_, i) => ({ title: `з${i}` })) }],
  });
  check('bulk_create держит потолок 40 задач', tooMany.includes('не больше 40'), tooMany);

  // --- компактность ответа ---
  const map = await call('get_roadmap', { id });
  check('get_roadmap отдаёт этапы с прогрессом', map.stages[0]?.progress?.total === 2);
  const sample = map.tasks[0];
  check('get_roadmap: есть заголовок и статус', Boolean(sample.title) && Boolean(sample.status));
  check('get_roadmap: есть связи', Array.isArray(sample.dependsOn));
  check('get_roadmap: описаний нет', !('description' in sample), Object.keys(sample).join(','));
  check('get_roadmap: заметок нет', !('notes' in sample));
  check('get_roadmap: критериев приёмки нет', !('acceptance' in sample));
  check('get_roadmap: координат нет', !('x' in sample) && !('y' in sample));
  check('get_roadmap: вводные по умолчанию не разворачиваются', map.roadmap.contextChars === 500);
  const withContext = await call('get_roadmap', { id, includeContext: true });
  check('get_roadmap: вводные по запросу приходят', withContext.roadmap.context?.length === 500);

  // --- точечное создание ---
  const stage = await call('create_stage', { id, title: 'Этап C', color: '#16a34a' });
  check('create_stage вернул id', /^st_/.test(stage.id ?? ''));
  const task = await call('create_task', {
    id,
    stageId: stage.id,
    title: 'Задача C1',
    description: 'создана точечно',
    acceptance: ['проверить вручную'],
    files: ['mcp/tools.js'],
    estimate: 1.5,
  });
  check('create_task вернул id', /^tk_/.test(task.id ?? ''));
  check('create_task: координаты не пришли в ответе', !('x' in task));
  const sub = await call('create_subtask', { id, taskId: task.id, title: 'пункт чеклиста' });
  check('create_subtask вернул id', /^sb_/.test(sub.id ?? ''));

  const badStage = await expectError('create_task', { id, stageId: 'st_zzzzzzzz', title: 'в никуда' });
  check('create_task не кладёт задачу в несуществующий этап', badStage.includes('не найден'), badStage);

  // --- переименование карты и этапа без потери данных ---
  const renamedMap = await call('update_roadmap', { id, title: 'Переименованная карта', goal: 'новая цель' });
  check('update_roadmap меняет название', renamedMap.title === 'Переименованная карта');
  check('update_roadmap меняет цель', renamedMap.goal === 'новая цель');
  check('update_roadmap не трогает вводные', renamedMap.context?.length === 500);
  check('update_roadmap сохраняет id', renamedMap.id === id);
  check('update_roadmap умеет архивировать', (await call('update_roadmap', { id, archived: true })).archived === true);
  await call('update_roadmap', { id, archived: false });
  const emptyMapPatch = await expectError('update_roadmap', { id });
  check('update_roadmap требует хотя бы одно поле', emptyMapPatch.includes('нечего менять'), emptyMapPatch);

  const renamedStage = await call('update_stage', { id, stageId: stage.id, title: 'Этап C (переименован)' });
  check('update_stage меняет название', renamedStage.title === 'Этап C (переименован)');
  check('update_stage сохраняет цвет', renamedStage.color === '#16a34a');
  check(
    'переименование этапа не теряет задачи',
    (await call('get_roadmap', { id })).stages.find((s) => s.id === stage.id)?.progress.total === 1,
  );
  const emptyStagePatch = await expectError('update_stage', { id, stageId: stage.id });
  check('update_stage требует хотя бы одно поле', emptyStagePatch.includes('нечего менять'));
  const badColor = await expectError('update_stage', { id, stageId: stage.id, color: 'синий' });
  check('update_stage проверяет формат цвета', badColor.length > 0);

  // --- правило 1: координаты через правку задачи не меняются ---
  const posAttempt = await expectError('update_task', { id, taskId: task.id, x: 100, y: 200 });
  check('update_task отклоняет x/y', posAttempt.length > 0, posAttempt);

  // --- подробности задачи ---
  const full = await call('get_task', { id, taskId: task.id });
  check('get_task отдаёт описание', full.description === 'создана точечно');
  check('get_task отдаёт критерии приёмки', full.acceptance?.[0] === 'проверить вручную');
  check('get_task отдаёт подзадачи', full.subtasks?.length === 1);
  check('get_task отдаёт ленту заметок', Array.isArray(full.notes));
  check('get_task отдаёт этап', full.stage?.id === stage.id);
  check('get_task отдаёт номер версии', full.version === 1);
  check('get_task отдаёт блокировки', Array.isArray(full.blockedBy) && Array.isArray(full.blocks));
  check('get_task не отдаёт координаты', !('x' in full));

  // --- правка с защитой от одновременного изменения ---
  const stale = await expectError('update_task', {
    id,
    taskId: task.id,
    title: 'из прошлого',
    version: 99,
  });
  check('update_task отклоняет старую версию', stale.includes('изменилась'), stale);
  check('ошибка версии подсказывает перечитать задачу', stale.includes('get_task'), stale);

  const updated = await call('update_task', {
    id,
    taskId: task.id,
    title: 'Задача C1 (правленая)',
    version: 1,
  });
  check('update_task применил правку', updated.title === 'Задача C1 (правленая)');
  check('update_task поднял версию', updated.version === 2);

  const nothing = await expectError('update_task', { id, taskId: task.id });
  check('update_task требует хотя бы одно поле', nothing.includes('нечего менять'), nothing);

  // --- статусы ---
  const noReason = await expectError('set_status', { id, taskId: task.id, status: 'blocked' });
  check('set_status требует причину для blocked', noReason.includes('reason'), noReason);

  const blocked = await call('set_status', {
    id,
    taskId: task.id,
    status: 'blocked',
    reason: 'жду ответа владельца',
  });
  check('set_status поставил blocked', blocked.status === 'blocked');
  check('причина блокировки попала в заметки', blocked.notes.at(-1)?.text.includes('жду ответа'));

  await call('set_status', { id, taskId: task.id, status: 'todo', reason: 'разблокировано' });

  // --- чеклист и заметки ---
  const toggled = await call('toggle_subtask', { id, taskId: task.id, subtaskId: sub.id });
  check('toggle_subtask ставит галочку', toggled.done === true);
  const untoggled = await call('toggle_subtask', { id, taskId: task.id, subtaskId: sub.id, done: false });
  check('toggle_subtask снимает галочку', untoggled.done === false);

  const note = await call('add_note', { id, taskId: task.id, text: 'проверено автотестом' });
  check('add_note пишет заметку', note.text === 'проверено автотестом');
  check('add_note помечает автора', note.author === 'agent');

  const noConfirmNote = await expectError('delete_note', { id, taskId: task.id, noteId: note.id, confirm: false });
  check('delete_note без подтверждения не работает', noConfirmNote.includes('подтвержд'), noConfirmNote);
  check(
    'delete_note с подтверждением убирает заметку',
    (await call('delete_note', { id, taskId: task.id, noteId: note.id, confirm: true })).deleted === note.id,
  );
  check(
    'заметки в задаче после удаления не осталось',
    !(await call('get_task', { id, taskId: task.id })).notes.some((n) => n.id === note.id),
  );
  const missingNote = await expectError('delete_note', { id, taskId: task.id, noteId: 'nt_нет', confirm: true });
  check('delete_note на несуществующей заметке честно ругается', missingNote.includes('не найдена'), missingNote);

  await call('add_note', { id, taskId: task.id, text: 'заметка для дальнейших проверок' });

  // --- связи ---
  const [a1, a2] = map.tasks;
  const linked = await call('link_tasks', { id, taskId: a2.id, dependsOn: a1.id });
  check('link_tasks добавил зависимость', linked.dependsOn.includes(a1.id));

  const cycle = await expectError('link_tasks', { id, taskId: a1.id, dependsOn: a2.id });
  check('link_tasks не даёт замкнуть круг', cycle.includes('круг'), cycle);
  const self = await expectError('link_tasks', { id, taskId: a1.id, dependsOn: a1.id });
  check('link_tasks не даёт зависеть от себя', self.includes('самой себя'), self);

  // --- главный инструмент ---
  const next = await call('get_next_task', { id });
  check('get_next_task вернул задачу', Boolean(next.task?.id), JSON.stringify(next).slice(0, 200));
  check('get_next_task не вернул заблокированную', next.task.id !== a2.id);
  check('get_next_task отдаёт описание задачи', typeof next.task.description === 'string');
  check('get_next_task считает остаток', typeof next.remaining === 'number');
  check('get_next_task не отдаёт координаты', !('x' in next.task));

  // закрываем всё и смотрим, что инструмент честно говорит «задач нет»
  for (const t of (await call('get_roadmap', { id })).tasks) {
    const fresh = await call('get_task', { id, taskId: t.id });
    if (fresh.status !== 'done') {
      await call('set_status', { id, taskId: t.id, status: 'done', version: fresh.version });
    }
  }
  const empty = await call('get_next_task', { id });
  check('get_next_task на закрытой карте говорит почему', empty.task === null && Boolean(empty.reason), JSON.stringify(empty));

  // --- поиск ---
  const found = await call('search_tasks', { id, query: 'A1' });
  check('search_tasks ищет по тексту', found.length === 1 && found[0].title === 'Задача A1', JSON.stringify(found));
  const byStatus = await call('search_tasks', { id, status: 'done' });
  check('search_tasks фильтрует по статусу', byStatus.length === 4, String(byStatus.length));
  const byFile = await call('search_tasks', { id, file: 'server/api.js' });
  check('search_tasks ищет по файлу', byFile.length === 1);
  check(
    'search_tasks отдаёт компактно',
    Object.keys(byFile[0]).sort().join(',') === 'id,stageId,status,title',
    Object.keys(byFile[0]).join(','),
  );

  const unlinked = await call('unlink_tasks', { id, taskId: a2.id, dependsOn: a1.id });
  check('unlink_tasks снял зависимость', !unlinked.dependsOn.includes(a1.id));

  // --- удаление: только с подтверждением ---
  const noConfirmSub = await expectError('delete_subtask', { id, taskId: task.id, subtaskId: sub.id, confirm: false });
  check('delete_subtask без подтверждения не работает', noConfirmSub.includes('подтвержд'), noConfirmSub);
  check(
    'delete_subtask с подтверждением работает',
    (await call('delete_subtask', { id, taskId: task.id, subtaskId: sub.id, confirm: true })).deleted === sub.id,
  );

  const noConfirmTask = await expectError('delete_task', { id, taskId: task.id, confirm: false });
  check('delete_task без подтверждения не работает', noConfirmTask.includes('подтвержд'));
  check(
    'delete_task с подтверждением работает',
    (await call('delete_task', { id, taskId: task.id, confirm: true })).deleted === task.id,
  );

  const noConfirmStage = await expectError('delete_stage', { id, stageId: stage.id, confirm: false });
  check('delete_stage без подтверждения не работает', noConfirmStage.includes('подтвержд'));
  check(
    'delete_stage с подтверждением работает',
    (await call('delete_stage', { id, stageId: stage.id, confirm: true })).deleted === stage.id,
  );

  const noConfirmMap = await expectError('delete_roadmap', { id, confirm: false });
  check('delete_roadmap без подтверждения не работает', noConfirmMap.includes('подтвержд'));
  check('delete_roadmap с подтверждением работает', (await call('delete_roadmap', { id, confirm: true })).deleted === id);
  check('карта исчезла из списка', !(await call('list_roadmaps')).roadmaps.some((r) => r.id === id));

  // --- понятные ошибки на несуществующем ---
  const missing = await expectError('get_roadmap', { id: 'rm_00000000' });
  check('нет карты — понятная ошибка', missing.includes('не найдена'), missing);
  const badId = await expectError('get_roadmap', { id: '../../etc/passwd' });
  check('кривой id отклоняется', badId.includes('идентификатор'), badId);
} catch (err) {
  failures.push(err.message);
  console.log(`\n  ОБРЫВ: ${err.message}`);
} finally {
  await client.close().catch(() => {});
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\nпройдено проверок: ${passed}`);
if (failures.length) {
  console.log(`провалено: ${failures.length}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('этап 2: все проверки пройдены');

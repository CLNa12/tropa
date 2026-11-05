// Операции над картой. Вся запись идёт только отсюда — и браузер, и MCP ходят через эти функции,
// чтобы проверки не разошлись между двумя реализациями (PRD, раздел 7).
import {
  BULK_TASK_LIMIT,
  BulkInput,
  LinkInput,
  NoteInput,
  PositionInput,
  PositionsInput,
  RoadmapInput,
  RoadmapPatch,
  StageInput,
  StagePatch,
  StatusInput,
  SubtaskInput,
  TemplateInput,
  TaskInput,
  TaskPatch,
  emptyRoadmapFile,
  newId,
  nowIso,
} from './schema.js';
import { roadmapToMarkdown, taskToPrompt } from './markdown.js';
import { findTemplate, templateToBulk } from './templates.js';
import {
  deleteRoadmap as removeFile,
  listRoadmapIds,
  readRoadmap,
  writeRoadmap,
} from './storage.js';

function fail(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  throw err;
}

function parse(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    fail(400, 'данные не прошли проверку', {
      issues: result.error.issues.map((i) => ({
        field: i.path.join('.') || '(корень)',
        message: i.message,
      })),
    });
  }
  return result.data;
}

const findStage = (file, id) => file.stages.find((s) => s.id === id);
const findTask = (file, id) => file.tasks.find((t) => t.id === id);

function touch(file) {
  file.roadmap.updatedAt = nowIso();
  return file;
}

/** Задача считается заблокированной связями, если хоть одна зависимость не done. */
function blockedBy(file, task) {
  return task.dependsOn.filter((id) => {
    const dep = findTask(file, id);
    return dep && dep.status !== 'done';
  });
}

/** Проверка, что новая связь не замкнёт круг: A→B→C→A. */
function wouldCycle(file, fromId, toId) {
  const seen = new Set();
  const walk = (id) => {
    if (id === fromId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const task = findTask(file, id);
    return task ? task.dependsOn.some(walk) : false;
  };
  return walk(toId);
}

// --- карты ---

export function listRoadmaps() {
  return listRoadmapIds()
    .map((id) => {
      const file = readRoadmap(id);
      const total = file.tasks.length;
      const done = file.tasks.filter((t) => t.status === 'done').length;
      return {
        id: file.roadmap.id,
        title: file.roadmap.title,
        goal: file.roadmap.goal,
        archived: file.roadmap.archived,
        updatedAt: file.roadmap.updatedAt,
        progress: { done, total },
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createRoadmap(body) {
  const input = parse(RoadmapInput, body);
  return writeRoadmap(emptyRoadmapFile(input)).roadmap;
}

export function patchRoadmap(id, body) {
  const patch = parse(RoadmapPatch, body);
  const file = readRoadmap(id);
  Object.assign(file.roadmap, patch);
  return writeRoadmap(touch(file)).roadmap;
}

export function deleteRoadmap(id, confirm) {
  if (confirm !== true) fail(400, 'удаление карты требует явного подтверждения: confirm=true');
  removeFile(id);
  return { deleted: id };
}

/**
 * Компактный вид карты: заголовки, статусы и связи, без описаний и заметок.
 * Подробности — через getTask (PRD, раздел 7, правило 2).
 */
export function getRoadmap(id) {
  const file = readRoadmap(id);
  return {
    roadmap: file.roadmap,
    stages: file.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => {
        const tasks = file.tasks.filter((t) => t.stageId === stage.id);
        return {
          ...stage,
          progress: { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length },
        };
      }),
    tasks: file.tasks.map((t) => ({
      id: t.id,
      stageId: t.stageId,
      title: t.title,
      status: t.status,
      dependsOn: t.dependsOn,
      subtasks: { done: t.subtasks.filter((s) => s.done).length, total: t.subtasks.length },
      x: t.x,
      y: t.y,
      version: t.version,
    })),
  };
}

// --- этапы ---

export function createStage(roadmapId, body) {
  const input = parse(StageInput, body);
  const file = readRoadmap(roadmapId);
  for (const dep of input.dependsOn) {
    if (!findStage(file, dep)) fail(400, `этап ${dep} из dependsOn не найден`);
  }
  const stage = {
    id: newId('st'),
    roadmapId: file.roadmap.id,
    title: input.title,
    order: input.order ?? file.stages.length,
    dependsOn: input.dependsOn,
    color: input.color ?? null,
  };
  file.stages.push(stage);
  writeRoadmap(touch(file));
  return stage;
}

export function patchStage(roadmapId, stageId, body) {
  const patch = parse(StagePatch, body);
  const file = readRoadmap(roadmapId);
  const stage = findStage(file, stageId);
  if (!stage) fail(404, `этап ${stageId} не найден`);
  Object.assign(stage, patch);
  writeRoadmap(touch(file));
  return stage;
}

export function deleteStage(roadmapId, stageId, confirm) {
  if (confirm !== true) fail(400, 'удаление этапа требует явного подтверждения: confirm=true');
  const file = readRoadmap(roadmapId);
  const stage = findStage(file, stageId);
  if (!stage) fail(404, `этап ${stageId} не найден`);
  const taskIds = file.tasks.filter((t) => t.stageId === stageId).map((t) => t.id);
  file.stages = file.stages.filter((s) => s.id !== stageId);
  file.tasks = file.tasks.filter((t) => t.stageId !== stageId);
  for (const task of file.tasks) task.dependsOn = task.dependsOn.filter((d) => !taskIds.includes(d));
  writeRoadmap(touch(file));
  return { deleted: stageId, tasksRemoved: taskIds.length };
}

// --- задачи ---

export function createTask(roadmapId, body) {
  const input = parse(TaskInput, body);
  const file = readRoadmap(roadmapId);
  if (!findStage(file, input.stageId)) fail(400, `этап ${input.stageId} не найден`);
  for (const dep of input.dependsOn) {
    if (!findTask(file, dep)) fail(400, `задача ${dep} из dependsOn не найдена`);
  }
  const ts = nowIso();
  const task = {
    id: newId('tk'),
    stageId: input.stageId,
    title: input.title,
    description: input.description,
    status: input.status,
    acceptance: input.acceptance,
    files: input.files,
    dependsOn: input.dependsOn,
    estimate: input.estimate,
    x: 0,
    y: 0,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    notes: [],
    subtasks: [],
  };
  file.tasks.push(task);
  writeRoadmap(touch(file));
  return task;
}

export function getTask(roadmapId, taskId) {
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  return {
    ...task,
    stage: findStage(file, task.stageId) ?? null,
    blockedBy: blockedBy(file, task),
    blocks: file.tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => t.id),
  };
}

/** Номер версии защищает от одновременной правки человеком и агентом (PRD, раздел 13). */
function assertVersion(task, sent) {
  if (sent !== undefined && sent !== task.version) {
    fail(409, `задача изменилась: на диске версия ${task.version}, прислана ${sent}. Перечитайте задачу.`, {
      currentVersion: task.version,
    });
  }
}

export function patchTask(roadmapId, taskId, body) {
  const patch = parse(TaskPatch, body);
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  assertVersion(task, patch.version);
  if (patch.stageId && !findStage(file, patch.stageId)) fail(400, `этап ${patch.stageId} не найден`);

  const { version, ...fields } = patch;
  Object.assign(task, fields);
  task.version += 1;
  task.updatedAt = nowIso();
  writeRoadmap(touch(file));
  return task;
}

export function setStatus(roadmapId, taskId, body) {
  const input = parse(StatusInput, body);
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  assertVersion(task, input.version);

  task.status = input.status;
  task.version += 1;
  task.updatedAt = nowIso();
  if (input.reason) {
    task.notes.push({
      id: newId('nt'),
      text: input.status === 'blocked' ? `Заблокировано: ${input.reason}` : input.reason,
      author: 'agent',
      createdAt: nowIso(),
    });
  }
  writeRoadmap(touch(file));
  return task;
}

export function setPosition(roadmapId, taskId, body) {
  const input = parse(PositionInput, body);
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  task.x = input.x;
  task.y = input.y;
  writeRoadmap(touch(file));
  return { id: task.id, x: task.x, y: task.y };
}

/** Карта целиком в markdown — для выгрузки в заметки или другому агенту. */
export function exportMarkdown(roadmapId) {
  const file = readRoadmap(roadmapId);
  return { markdown: roadmapToMarkdown(file), title: file.roadmap.title };
}

/** Готовый текст задачи для Claude — кнопка в панели задачи (PRD, раздел 8). */
export function taskPrompt(roadmapId, taskId) {
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  return { prompt: taskToPrompt(file, task) };
}

/** Карта из шаблона: создаём, наполняем через ту же bulkCreate и связываем по порядку. */
export function createFromTemplate(body) {
  const input = parse(TemplateInput, body);
  const template = findTemplate(input.templateId);
  if (!template) fail(404, `шаблон ${input.templateId} не найден`);

  const roadmap = createRoadmap({
    title: input.title ?? template.title,
    goal: input.goal ?? template.goal,
    context: input.context ?? '',
  });

  if (template.stages.length === 0) return { ...roadmap, templateId: template.id, tasks: 0 };

  const created = bulkCreate(roadmap.id, templateToBulk(template));
  if (template.chain) {
    const file = readRoadmap(roadmap.id);
    for (let i = 1; i < created.tasks.length; i += 1) {
      findTask(file, created.tasks[i]).dependsOn = [created.tasks[i - 1]];
    }
    writeRoadmap(touch(file));
  }
  return { ...roadmap, templateId: template.id, tasks: created.tasks.length };
}

export function setPositions(roadmapId, body) {
  const input = parse(PositionsInput, body);
  const file = readRoadmap(roadmapId);
  const moved = [];
  for (const point of input.positions) {
    const task = findTask(file, point.id);
    if (!task) fail(404, `задача ${point.id} не найдена`);
    task.x = point.x;
    task.y = point.y;
    moved.push({ id: task.id, x: task.x, y: task.y });
  }
  writeRoadmap(touch(file));
  return { positions: moved };
}

export function addNote(roadmapId, taskId, body) {
  const input = parse(NoteInput, body);
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  const note = { id: newId('nt'), text: input.text, author: input.author, createdAt: nowIso() };
  task.notes.push(note);
  task.updatedAt = note.createdAt;
  writeRoadmap(touch(file));
  return note;
}

export function deleteNote(roadmapId, taskId, noteId, confirm) {
  if (confirm !== true) fail(400, 'удаление заметки требует явного подтверждения: confirm=true');
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  if (!task.notes.some((n) => n.id === noteId)) fail(404, `заметка ${noteId} не найдена`);
  task.notes = task.notes.filter((n) => n.id !== noteId);
  task.updatedAt = nowIso();
  writeRoadmap(touch(file));
  return { deleted: noteId };
}

export function deleteTask(roadmapId, taskId, confirm) {
  if (confirm !== true) fail(400, 'удаление задачи требует явного подтверждения: confirm=true');
  const file = readRoadmap(roadmapId);
  if (!findTask(file, taskId)) fail(404, `задача ${taskId} не найдена`);
  file.tasks = file.tasks.filter((t) => t.id !== taskId);
  for (const task of file.tasks) task.dependsOn = task.dependsOn.filter((d) => d !== taskId);
  writeRoadmap(touch(file));
  return { deleted: taskId };
}

// --- подзадачи ---

export function createSubtask(roadmapId, taskId, body) {
  const input = parse(SubtaskInput, body);
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  const subtask = {
    id: newId('sb'),
    taskId: task.id,
    title: input.title,
    done: input.done,
    order: input.order ?? task.subtasks.length,
  };
  task.subtasks.push(subtask);
  task.updatedAt = nowIso();
  writeRoadmap(touch(file));
  return subtask;
}

export function toggleSubtask(roadmapId, taskId, subtaskId, done) {
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  const subtask = task.subtasks.find((s) => s.id === subtaskId);
  if (!subtask) fail(404, `подзадача ${subtaskId} не найдена`);
  subtask.done = typeof done === 'boolean' ? done : !subtask.done;
  task.updatedAt = nowIso();
  writeRoadmap(touch(file));
  return subtask;
}

export function deleteSubtask(roadmapId, taskId, subtaskId, confirm) {
  if (confirm !== true) fail(400, 'удаление подзадачи требует явного подтверждения: confirm=true');
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  const before = task.subtasks.length;
  task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
  if (task.subtasks.length === before) fail(404, `подзадача ${subtaskId} не найдена`);
  writeRoadmap(touch(file));
  return { deleted: subtaskId };
}

// --- связи ---

export function linkTasks(roadmapId, taskId, body) {
  const input = parse(LinkInput, body);
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  if (!findTask(file, input.dependsOn)) fail(400, `задача ${input.dependsOn} не найдена`);
  if (input.dependsOn === taskId) fail(400, 'задача не может зависеть от самой себя');
  if (wouldCycle(file, taskId, input.dependsOn)) fail(400, 'связь замкнула бы круг зависимостей');
  if (!task.dependsOn.includes(input.dependsOn)) task.dependsOn.push(input.dependsOn);
  task.version += 1;
  task.updatedAt = nowIso();
  writeRoadmap(touch(file));
  return { id: task.id, dependsOn: task.dependsOn };
}

export function unlinkTasks(roadmapId, taskId, dependsOn) {
  const file = readRoadmap(roadmapId);
  const task = findTask(file, taskId);
  if (!task) fail(404, `задача ${taskId} не найдена`);
  task.dependsOn = task.dependsOn.filter((d) => d !== dependsOn);
  task.version += 1;
  task.updatedAt = nowIso();
  writeRoadmap(touch(file));
  return { id: task.id, dependsOn: task.dependsOn };
}

// --- главное для агента ---

/** Первая задача, у которой все зависимости закрыты (PRD, раздел 7). */
export function getNextTask(roadmapId) {
  const file = readRoadmap(roadmapId);
  const stageOrder = new Map(file.stages.map((s) => [s.id, s.order]));
  const candidates = file.tasks
    .filter((t) => t.status === 'todo' || t.status === 'in_progress')
    .filter((t) => blockedBy(file, t).length === 0)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
      const sa = stageOrder.get(a.stageId) ?? 0;
      const sb = stageOrder.get(b.stageId) ?? 0;
      return sa - sb || a.createdAt.localeCompare(b.createdAt);
    });

  if (candidates.length === 0) {
    const stuck = file.tasks.filter((t) => t.status !== 'done');
    return {
      task: null,
      reason: stuck.length === 0 ? 'все задачи закрыты' : 'свободных задач нет: остальные заблокированы',
      blocked: stuck.map((t) => ({ id: t.id, title: t.title, blockedBy: blockedBy(file, t) })),
    };
  }
  const task = candidates[0];
  return {
    task: {
      ...task,
      stage: findStage(file, task.stageId) ?? null,
      blocks: file.tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => t.id),
    },
    remaining: file.tasks.filter((t) => t.status !== 'done').length,
  };
}

export function searchTasks(roadmapId, { query = '', status = '', file: filePath = '' } = {}) {
  const file = readRoadmap(roadmapId);
  const q = query.trim().toLowerCase();
  return file.tasks
    .filter((t) => (status ? t.status === status : true))
    .filter((t) => (filePath ? t.files.some((f) => f.includes(filePath)) : true))
    .filter((t) =>
      q ? t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) : true,
    )
    .map((t) => ({ id: t.id, stageId: t.stageId, title: t.title, status: t.status }));
}

// --- дерево за один вызов ---

export function bulkCreate(roadmapId, body) {
  const input = parse(BulkInput, body);
  const taskCount = input.stages.reduce((n, s) => n + s.tasks.length, 0);
  if (taskCount > BULK_TASK_LIMIT) {
    fail(400, `за один вызов не больше ${BULK_TASK_LIMIT} задач, прислано ${taskCount}`);
  }
  const file = readRoadmap(roadmapId);
  const ts = nowIso();
  const created = { stages: [], tasks: [], subtasks: 0 };

  for (const stageInput of input.stages) {
    const stage = {
      id: newId('st'),
      roadmapId: file.roadmap.id,
      title: stageInput.title,
      order: file.stages.length,
      dependsOn: [],
      color: stageInput.color ?? null,
    };
    file.stages.push(stage);
    created.stages.push(stage.id);

    for (const taskInput of stageInput.tasks) {
      const task = {
        id: newId('tk'),
        stageId: stage.id,
        title: taskInput.title,
        description: taskInput.description,
        status: taskInput.status,
        acceptance: taskInput.acceptance,
        files: taskInput.files,
        dependsOn: [],
        estimate: taskInput.estimate,
        x: 0,
        y: 0,
        version: 1,
        createdAt: ts,
        updatedAt: ts,
        notes: [],
        subtasks: taskInput.subtasks.map((title, index) => ({
          id: newId('sb'),
          taskId: '',
          title,
          done: false,
          order: index,
        })),
      };
      for (const sub of task.subtasks) sub.taskId = task.id;
      created.subtasks += task.subtasks.length;
      file.tasks.push(task);
      created.tasks.push(task.id);
    }
  }
  writeRoadmap(touch(file));
  return created;
}

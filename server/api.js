// HTTP-слой: тонкая обёртка над repo.js. Вся логика и проверки — там.
import express from 'express';
import * as repo from './repo.js';
import { HOME_DIR, historyFor } from './storage.js';
import { onChange, withSource } from './events.js';

/** Ошибки из repo приходят с полем status; всё остальное — 500. */
function wrap(handler) {
  return (req, res) => {
    try {
      // Браузер присылает заголовок x-tropa-source: human — по нему вкладка отличает
      // свои правки от правок агента и подсвечивает только чужие.
      const result = withSource(req.get('x-tropa-source'), () => handler(req));
      res.json(result ?? { ok: true });
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error('[tropa]', err);
      res.status(status).json({
        error: err.message,
        ...(err.issues ? { issues: err.issues } : {}),
        ...(err.currentVersion ? { currentVersion: err.currentVersion } : {}),
      });
    }
  };
}

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

export function createApi() {
  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));

  api.get('/health', wrap(() => ({ ok: true, storage: HOME_DIR })));

  // Живое обновление: вкладка держит это соединение открытым и слушает правки (PRD, раздел 8).
  api.get('/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': поток изменений Tropa открыт\n\n');
    const stop = onChange((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    // Пустой комментарий раз в 25 секунд — чтобы соединение не закрыли по тишине.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      stop();
    });
  });

  // карты
  api.get('/roadmaps', wrap(() => ({ roadmaps: repo.listRoadmaps() })));
  api.post('/roadmaps', wrap((req) => repo.createRoadmap(req.body)));
  api.get('/roadmaps/:id', wrap((req) => repo.getRoadmap(req.params.id)));
  api.patch('/roadmaps/:id', wrap((req) => repo.patchRoadmap(req.params.id, req.body)));
  api.delete(
    '/roadmaps/:id',
    wrap((req) => repo.deleteRoadmap(req.params.id, truthy(req.query.confirm ?? req.body?.confirm))),
  );
  api.get('/roadmaps/:id/history', wrap((req) => ({ backups: historyFor(req.params.id) })));

  // этапы
  api.post('/roadmaps/:id/stages', wrap((req) => repo.createStage(req.params.id, req.body)));
  api.patch(
    '/roadmaps/:id/stages/:stageId',
    wrap((req) => repo.patchStage(req.params.id, req.params.stageId, req.body)),
  );
  api.delete(
    '/roadmaps/:id/stages/:stageId',
    wrap((req) =>
      repo.deleteStage(req.params.id, req.params.stageId, truthy(req.query.confirm ?? req.body?.confirm)),
    ),
  );

  // задачи
  api.post('/roadmaps/:id/tasks', wrap((req) => repo.createTask(req.params.id, req.body)));
  api.post('/roadmaps/:id/bulk', wrap((req) => repo.bulkCreate(req.params.id, req.body)));
  api.get('/roadmaps/:id/next-task', wrap((req) => repo.getNextTask(req.params.id)));
  api.get(
    '/roadmaps/:id/search',
    wrap((req) =>
      repo.searchTasks(req.params.id, {
        query: String(req.query.q ?? ''),
        status: String(req.query.status ?? ''),
        file: String(req.query.file ?? ''),
      }),
    ),
  );
  api.get('/roadmaps/:id/tasks/:taskId', wrap((req) => repo.getTask(req.params.id, req.params.taskId)));
  api.patch(
    '/roadmaps/:id/tasks/:taskId',
    wrap((req) => repo.patchTask(req.params.id, req.params.taskId, req.body)),
  );
  api.delete(
    '/roadmaps/:id/tasks/:taskId',
    wrap((req) =>
      repo.deleteTask(req.params.id, req.params.taskId, truthy(req.query.confirm ?? req.body?.confirm)),
    ),
  );
  api.post(
    '/roadmaps/:id/tasks/:taskId/status',
    wrap((req) => repo.setStatus(req.params.id, req.params.taskId, req.body)),
  );
  api.post(
    '/roadmaps/:id/tasks/:taskId/position',
    wrap((req) => repo.setPosition(req.params.id, req.params.taskId, req.body)),
  );
  api.post(
    '/roadmaps/:id/tasks/:taskId/notes',
    wrap((req) => repo.addNote(req.params.id, req.params.taskId, req.body)),
  );
  api.delete(
    '/roadmaps/:id/tasks/:taskId/notes/:noteId',
    wrap((req) =>
      repo.deleteNote(
        req.params.id,
        req.params.taskId,
        req.params.noteId,
        truthy(req.query.confirm ?? req.body?.confirm),
      ),
    ),
  );
  api.post(
    '/roadmaps/:id/tasks/:taskId/links',
    wrap((req) => repo.linkTasks(req.params.id, req.params.taskId, req.body)),
  );
  api.delete(
    '/roadmaps/:id/tasks/:taskId/links/:dependsOn',
    wrap((req) => repo.unlinkTasks(req.params.id, req.params.taskId, req.params.dependsOn)),
  );

  // подзадачи
  api.post(
    '/roadmaps/:id/tasks/:taskId/subtasks',
    wrap((req) => repo.createSubtask(req.params.id, req.params.taskId, req.body)),
  );
  api.patch(
    '/roadmaps/:id/tasks/:taskId/subtasks/:subtaskId',
    wrap((req) =>
      repo.toggleSubtask(req.params.id, req.params.taskId, req.params.subtaskId, req.body?.done),
    ),
  );
  api.delete(
    '/roadmaps/:id/tasks/:taskId/subtasks/:subtaskId',
    wrap((req) =>
      repo.deleteSubtask(
        req.params.id,
        req.params.taskId,
        req.params.subtaskId,
        truthy(req.query.confirm ?? req.body?.confirm),
      ),
    ),
  );

  api.use((req, res) => res.status(404).json({ error: `неизвестный маршрут: ${req.method} ${req.originalUrl}` }));
  return api;
}

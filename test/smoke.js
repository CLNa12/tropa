// Сквозная проверка этапа 1: поднимает API на временной папке и проходит весь путь —
// создать карту с этапами и задачами, прочитать обратно, проверить защиты.
// Запуск: npm run smoke
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = mkdtempSync(join(tmpdir(), 'tropa-test-'));
process.env.TROPA_HOME = sandbox;

const { createServer } = await import('../server/index.js');
const { HOME_DIR } = await import('../server/storage.js');

const server = createServer().listen(0, '127.0.0.1');
await new Promise((done) => server.once('listening', done));
const base = `http://127.0.0.1:${server.address().port}/api`;

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

async function call(method, path, body, expected = 200) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (res.status !== expected) {
    throw new Error(`${method} ${path}: ожидался код ${expected}, пришёл ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

try {
  console.log(`временная папка хранилища: ${HOME_DIR}\n`);

  console.log('1. Карта');
  const health = await call('GET', '/health');
  check('сервер отвечает', health.ok === true);

  const roadmap = await call('POST', '/roadmaps', {
    title: 'Tropa',
    goal: 'Claude спрашивает карту «что дальше» и сам отмечает сделанное',
    context: 'Локально, один пользователь, PRD 1.0',
  });
  check('карта создана и получила id', /^rm_[a-z0-9]{8}$/.test(roadmap.id), roadmap.id);
  check('файл карты лежит на диске', existsSync(join(sandbox, 'roadmaps', `${roadmap.id}.json`)));

  console.log('\n2. Этапы и задачи');
  const stage1 = await call('POST', `/roadmaps/${roadmap.id}/stages`, { title: '0. Разведка', color: '#4c8bf5' });
  const stage2 = await call('POST', `/roadmaps/${roadmap.id}/stages`, { title: '1. Ядро' });
  check('два этапа созданы', Boolean(stage1.id && stage2.id));
  check('порядок этапов проставлен сам', stage1.order === 0 && stage2.order === 1);

  const probe = await call('POST', `/roadmaps/${roadmap.id}/tasks`, {
    stageId: stage1.id,
    title: 'Мини-MCP с одним инструментом',
    description: 'Поднять сервер на официальном SDK, транспорт stdio.',
    acceptance: ['Claude вызывает ping', 'в ответе есть время'],
  });
  const core = await call('POST', `/roadmaps/${roadmap.id}/tasks`, {
    stageId: stage2.id,
    title: 'Хранилище и API',
    dependsOn: [probe.id],
    estimate: 4,
  });
  check('задачи созданы, версия начинается с 1', probe.version === 1 && core.version === 1);
  check('координаты канваса агент не задаёт', probe.x === 0 && probe.y === 0);

  // Канвас: координаты ставятся отдельными ручками, обычная правка их не трогает.
  const moved = await call('POST', `/roadmaps/${roadmap.id}/tasks/${probe.id}/position`, { x: 120, y: 48 });
  check('координату одной ноды можно сохранить', moved.x === 120 && moved.y === 48);
  const renamed = await call('PATCH', `/roadmaps/${roadmap.id}/tasks/${probe.id}`, {
    title: 'Каркас сервера',
    version: probe.version,
  });
  check('правка задачи координаты не сдвигает', renamed.x === 120 && renamed.y === 48);
  const batch = await call('POST', `/roadmaps/${roadmap.id}/positions`, {
    positions: [
      { id: probe.id, x: 10, y: 20 },
      { id: core.id, x: 310, y: 20 },
    ],
  });
  check('раскладка сохраняется одной записью', batch.positions.length === 2 && batch.positions[0].x === 10);
  const badLayout = await call(
    'POST',
    `/roadmaps/${roadmap.id}/positions`,
    { positions: [{ id: 'tk_нет', x: 1, y: 1 }] },
    404,
  );
  check('раскладка с несуществующей задачей отклоняется', String(badLayout.error).includes('не найдена'));

  console.log('\n3. Чтение обратно');
  const view = await call('GET', `/roadmaps/${roadmap.id}`);
  check('карта читается обратно целиком', view.stages.length === 2 && view.tasks.length === 2);
  check('у этапа считается прогресс', view.stages[0].progress.total === 1);
  check(
    'компактный ответ без описаний и заметок',
    view.tasks.every((t) => t.description === undefined && t.notes === undefined),
  );
  const full = await call('GET', `/roadmaps/${roadmap.id}/tasks/${probe.id}`);
  check('подробности задачи берутся отдельно', full.description.startsWith('Поднять сервер'));
  check('видно, что задача блокирует другую', full.blocks.includes(core.id));

  console.log('\n4. Подзадачи и заметки');
  const sub = await call('POST', `/roadmaps/${roadmap.id}/tasks/${probe.id}/subtasks`, { title: 'Написать server.js' });
  await call('PATCH', `/roadmaps/${roadmap.id}/tasks/${probe.id}/subtasks/${sub.id}`, { done: true });
  const note = await call('POST', `/roadmaps/${roadmap.id}/tasks/${probe.id}/notes`, {
    text: 'SDK 1.32.2, транспорт stdio',
    author: 'agent',
  });
  check('заметка записана с автором', note.author === 'agent');
  const afterSub = await call('GET', `/roadmaps/${roadmap.id}`);
  const probeRow = afterSub.tasks.find((t) => t.id === probe.id);
  check('счётчик подзадач 1/1', probeRow.subtasks.done === 1 && probeRow.subtasks.total === 1);

  console.log('\n5. Что дальше');
  const next1 = await call('GET', `/roadmaps/${roadmap.id}/next-task`);
  check('следующая задача — незаблокированная', next1.task.id === probe.id, next1.task?.title);

  console.log('\n6. Проверки и защиты');
  await call('POST', `/roadmaps/${roadmap.id}/tasks`, { stageId: stage1.id, title: '' }, 400);
  check('пустой заголовок отклонён', true);

  const blocked = await call('POST', `/roadmaps/${roadmap.id}/tasks/${core.id}/status`, { status: 'blocked' }, 400);
  check('blocked без причины отклонён', blocked.issues?.[0]?.field === 'reason');

  await call('POST', `/roadmaps/${roadmap.id}/tasks/${core.id}/status`, {
    status: 'blocked',
    reason: 'ждём этап 0',
  });
  check('blocked с причиной принят', true);

  const stale = await call('PATCH', `/roadmaps/${roadmap.id}/tasks/${core.id}`, { title: 'Правка', version: 1 }, 409);
  check('правка со старой версией отклонена', stale.currentVersion === 2, JSON.stringify(stale));

  await call('POST', `/roadmaps/${roadmap.id}/tasks/${probe.id}/links`, { dependsOn: core.id }, 400);
  check('круговая зависимость отклонена', true);

  await call('DELETE', `/roadmaps/${roadmap.id}/tasks/${core.id}`, null, 400);
  check('удаление без подтверждения отклонено', true);

  const tooMany = {
    stages: [{ title: 'Перебор', tasks: Array.from({ length: 41 }, (_, i) => ({ title: `Задача ${i}` })) }],
  };
  await call('POST', `/roadmaps/${roadmap.id}/bulk`, tooMany, 400);
  check('потолок в 40 задач на вызов работает', true);

  console.log('\n7. Дерево за один вызов');
  const bulk = await call('POST', `/roadmaps/${roadmap.id}/bulk`, {
    stages: [
      {
        title: '2. MCP',
        tasks: [
          { title: 'Инструменты чтения', subtasks: ['list_roadmaps', 'get_next_task'] },
          { title: 'Инструменты записи' },
        ],
      },
    ],
  });
  check('дерево создано одним вызовом', bulk.tasks.length === 2 && bulk.subtasks === 2);

  console.log('\n8. Автокопии');
  const history = await call('GET', `/roadmaps/${roadmap.id}/history`);
  check('копии складываются перед каждой записью', history.backups.length > 5, `${history.backups.length} шт.`);
  check('папка истории на диске есть', readdirSync(join(sandbox, 'history')).includes(roadmap.id));

  console.log('\n9. Список карт');
  const all = await call('GET', '/roadmaps');
  check('карта видна в списке с прогрессом', all.roadmaps[0].progress.total === 4, JSON.stringify(all.roadmaps[0]));
} catch (err) {
  failures.push(err.message);
  console.error('\nОШИБКА:', err.message);
} finally {
  server.close();
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\nпройдено проверок: ${passed}, провалено: ${failures.length}`);
if (failures.length) {
  console.log('не прошли:', failures.join(' | '));
  process.exit(1);
}
console.log('этап 1: ядро работает');

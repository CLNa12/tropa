// Хранилище: один JSON-файл на карту + автокопия перед каждой записью (PRD, раздел 6).
// Папка общая, в домашней директории: карты не привязаны к папке проекта и не лежат в git.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RoadmapFile } from './schema.js';
import { emitChange } from './events.js';

/** Папку можно переопределить через TROPA_HOME — этим пользуются тесты. */
export const HOME_DIR = resolve(process.env.TROPA_HOME?.trim() || join(homedir(), '.tropa'));
export const MAPS_DIR = join(HOME_DIR, 'roadmaps');
export const HISTORY_DIR = join(HOME_DIR, 'history');

/** Сколько автокопий держим на карту. Старые вычищаются. */
const HISTORY_LIMIT = 50;

export function ensureDirs() {
  mkdirSync(MAPS_DIR, { recursive: true });
  mkdirSync(HISTORY_DIR, { recursive: true });
}

const fileFor = (id) => join(MAPS_DIR, `${id}.json`);

/** id приходит из URL — проверяем форму, чтобы никто не вышел за пределы папки. */
export function assertSafeId(id) {
  if (!/^[a-z]{2}_[a-z0-9]{8}$/.test(String(id ?? ''))) {
    const err = new Error(`неизвестный идентификатор: ${id}`);
    err.status = 400;
    throw err;
  }
}

export function listRoadmapIds() {
  ensureDirs();
  return readdirSync(MAPS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5));
}

export function readRoadmap(id) {
  assertSafeId(id);
  const path = fileFor(id);
  if (!existsSync(path)) {
    const err = new Error(`карта ${id} не найдена`);
    err.status = 404;
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const err = new Error(`файл карты ${id} повреждён: ${cause.message}`);
    err.status = 500;
    throw err;
  }
  const parsed = RoadmapFile.safeParse(raw);
  if (!parsed.success) {
    const err = new Error(`файл карты ${id} не соответствует структуре: ${parsed.error.issues[0]?.message}`);
    err.status = 500;
    throw err;
  }
  return parsed.data;
}

/** Копия текущего файла в history/<id>/<метка времени>.json перед перезаписью. */
function backup(id) {
  const path = fileFor(id);
  if (!existsSync(path)) return null;
  const dir = join(HISTORY_DIR, id);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `${stamp}.json`);
  copyFileSync(path, target);

  const kept = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  for (const old of kept.slice(0, Math.max(0, kept.length - HISTORY_LIMIT))) {
    rmSync(join(dir, old), { force: true });
  }
  return target;
}

/**
 * Запись карты: сначала проверка структуры, потом автокопия, потом атомарная замена
 * через временный файл — на случай, если процесс упадёт посреди записи.
 */
export function writeRoadmap(data) {
  ensureDirs();
  const parsed = RoadmapFile.safeParse(data);
  if (!parsed.success) {
    const err = new Error(
      `отказ записи: структура карты нарушена — ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
    err.status = 500;
    throw err;
  }
  const id = parsed.data.roadmap.id;
  assertSafeId(id);
  backup(id);

  const path = fileFor(id);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(parsed.data, null, 2), 'utf8');
  renameSync(tmp, path);
  emitChange('roadmap', id); // вкладка в браузере узнаёт о правке
  return parsed.data;
}

export function deleteRoadmap(id) {
  assertSafeId(id);
  const path = fileFor(id);
  if (!existsSync(path)) {
    const err = new Error(`карта ${id} не найдена`);
    err.status = 404;
    throw err;
  }
  backup(id);
  rmSync(path, { force: true });
  emitChange('deleted', id);
}

export function historyFor(id) {
  assertSafeId(id);
  const dir = join(HISTORY_DIR, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => ({ name, size: statSync(join(dir, name)).size }));
}

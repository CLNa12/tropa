// Доступ к карте только через HTTP-API этапа 1 — в файлы MCP не лезет (PRD, раздел 7).
//
// Два режима, выбираются сами:
//   external — рядом уже запущен `npm start`, ходим в него (браузер и агент видят одно и то же);
//   embedded — сервера нет, поднимаем тот же Express внутри своего процесса на свободном порту.
// Второй режим нужен, чтобы агент работал без просьбы «сначала запустите сервер».
import { createServer } from '../server/index.js';
import { HOST, PORT } from '../server/config.js';

/** Ошибка от API: текст, код и подробности проверки — в удобном для агента виде. */
export class ApiError extends Error {
  constructor(status, payload) {
    const parts = [payload?.error || `API ответил кодом ${status}`];
    for (const issue of payload?.issues ?? []) parts.push(`· ${issue.field}: ${issue.message}`);
    if (payload?.currentVersion) {
      parts.push(`· актуальная версия задачи: ${payload.currentVersion} — перечитайте её через get_task`);
    }
    super(parts.join('\n'));
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function healthy(base) {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(700) });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.ok === true && typeof json.storage === 'string';
  } catch {
    return false;
  }
}

let resolving = null;

/** Один раз находит (или поднимает) API и дальше возвращает тот же адрес. */
export function ready() {
  resolving ??= (async () => {
    const external = `http://${HOST}:${PORT}/api`;
    if (await healthy(external)) return { base: external, mode: 'external', port: PORT };

    const listener = createServer().listen(0, '127.0.0.1');
    await new Promise((done, fail) => {
      listener.once('listening', done);
      listener.once('error', fail);
    });
    const port = listener.address().port;
    return { base: `http://127.0.0.1:${port}/api`, mode: 'embedded', port };
  })();
  return resolving;
}

/** Единственный способ достать или изменить данные. Путь — как в server/api.js. */
export async function api(method, path, body) {
  const { base } = await ready();
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: `API вернул не JSON: ${text.slice(0, 200)}` };
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

/** Части пути приходят от агента — экранируем, чтобы id не ломал адрес. */
export const seg = (value) => encodeURIComponent(String(value ?? ''));

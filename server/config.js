// Где слушать и где хранить карты. Одно место на весь проект, чтобы сервер, MCP и тесты
// понимали переменные одинаково.
//
// Адрес берём из TROPA_HOST/TROPA_PORT, а если их нет — из HOST/PORT (так проще в Docker
// и на хостингах). По умолчанию 127.0.0.1:4317 — то есть локальный запуск не меняется:
// сервер виден только с этого компьютера.
const pick = (...values) => values.find((v) => typeof v === 'string' && v.trim() !== '')?.trim();

export const HOST = pick(process.env.TROPA_HOST, process.env.HOST) ?? '127.0.0.1';

const rawPort = pick(process.env.TROPA_PORT, process.env.PORT) ?? '4317';
const parsedPort = Number(rawPort);
if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
  throw new Error(`непонятный порт: ${rawPort}. Нужно целое число от 0 до 65535`);
}
export const PORT = parsedPort;

/** Слушаем ли мы не только себя: в этом случае приложение доступно по сети. */
export const IS_PUBLIC = HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1';

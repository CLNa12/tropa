// Точка входа сервера Tropa. Слушает только локальный адрес, авторизации нет,
// в сеть не выходит (PRD, раздел 9).
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './api.js';
import { HOME_DIR, ensureDirs } from './storage.js';

const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

const HOST = process.env.TROPA_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TROPA_PORT ?? 4317);

export function createServer() {
  ensureDirs();
  const app = express();
  app.use('/api', createApi());

  // Собранный интерфейс, если он есть: тогда всё приложение живёт на одном адресе.
  // Во время разработки вместо этого работает `npm run web:dev` со своим адресом.
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
  }
  return app;
}

// Запуск только при прямом вызове `node server/index.js`, не при импорте из тестов.
const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  createServer().listen(PORT, HOST, () => {
    console.log(`[tropa] API на http://${HOST}:${PORT}/api  ·  карты в ${HOME_DIR}`);
  });
}

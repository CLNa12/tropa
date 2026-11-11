// Точка входа сервера Tropa. По умолчанию слушает только локальный адрес и авторизации не имеет
// (PRD, раздел 9). Адрес и порт можно переопределить переменными окружения — см. config.js.
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './api.js';
import { HOST, IS_PUBLIC, PORT } from './config.js';
import { HOME_DIR, ensureDirs } from './storage.js';

const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

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
    if (IS_PUBLIC) {
      console.warn(
        `[tropa] ВНИМАНИЕ: сервер слушает ${HOST}, то есть доступен не только с этого компьютера. ` +
          'Авторизации в Tropa нет — кто откроет адрес, тот увидит и правит все карты. ' +
          'Это нормально внутри контейнера, но наружу такой порт не выставляйте.',
      );
    }
  });
}

// Удалённый MCP-сервер Tropa: тот же набор инструментов, что и по stdio, но доступный
// по сети. Нужен, чтобы агент правил карту на сервере, а не на чьём-то ноутбуке.
//
// Транспорт — Streamable HTTP из официального SDK, одна ручка POST /mcp.
// Каждый запрос обслуживается своим экземпляром сервера: состояние между запросами
// не хранится, поэтому перезапуск контейнера ничего не ломает.
//
// Защита — секретный токен в заголовке. Без него ручка не отвечает ничего полезного.
// Токен берётся из TROPA_MCP_TOKEN и в репозиторий не попадает.
import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// server.js при обычном импорте сам поднимает stdio-транспорт — здесь он не нужен.
process.env.TROPA_MCP_NO_AUTOSTART = '1';
const { buildServer, VERSION } = await import('./server.js');
const { tools } = await import('./tools.js');

const TOKEN = process.env.TROPA_MCP_TOKEN?.trim();
if (!TOKEN || TOKEN.length < 24) {
  console.error(
    '[tropa-mcp] не задан TROPA_MCP_TOKEN (нужна строка от 24 символов). ' +
      'Без токена сервер открыт всем, поэтому запуск отменён.',
  );
  process.exit(1);
}
// Заголовки HTTP не умеют в кириллицу и прочий юникод — такой токен клиент просто не отправит.
if (!/^[\x21-\x7e]+$/.test(TOKEN)) {
  console.error('[tropa-mcp] TROPA_MCP_TOKEN должен состоять из латиницы, цифр и знаков — без пробелов и кириллицы.');
  process.exit(1);
}

const HOST = process.env.TROPA_MCP_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TROPA_MCP_PORT?.trim() || '4318');

/** Сравнение за одинаковое время: иначе токен можно подобрать по скорости ответа. */
function tokenOk(given) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function presentedToken(req) {
  const auth = req.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.get('x-tropa-token')?.trim();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Проверка живости — без токена, чтобы Docker и Traefik могли стучаться.
app.get('/health', (req, res) => res.json({ ok: true, mcp: VERSION, tools: tools.length }));

app.use('/mcp', (req, res, next) => {
  if (tokenOk(presentedToken(req))) return next();
  const id = randomUUID().slice(0, 8);
  console.warn(`[tropa-mcp] отказ ${id}: неверный или отсутствующий токен (${req.ip})`);
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'нужен токен: заголовок Authorization: Bearer <токен>' },
    id: null,
  });
});

app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // без сессий: каждый запрос самодостаточен
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[tropa-mcp] ошибка обработки запроса:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'внутренняя ошибка сервера' },
        id: null,
      });
    }
  }
});

// Без сессий поток событий и закрытие сессии не нужны — отвечаем честно.
app.get('/mcp', (req, res) => res.status(405).json({ error: 'используйте POST /mcp' }));
app.delete('/mcp', (req, res) => res.status(405).json({ error: 'сессий нет, закрывать нечего' }));

app.listen(PORT, HOST, () => {
  console.log(
    `[tropa-mcp] удалённый MCP ${VERSION} на http://${HOST}:${PORT}/mcp · инструментов: ${tools.length} · вход по токену`,
  );
});

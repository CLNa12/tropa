// Tropa — этап 0 (разведка).
// Минимальный MCP-сервер на официальном SDK, транспорт stdio, один инструмент ping.
// Цель этапа: убедиться, что рабочая среда подключает локальный MCP и вызывает его инструмент.
// Из приложения Tropa здесь нет ничего — только проверка связи.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'tropa-probe',
  version: '0.1.0',
});

server.registerTool(
  'ping',
  {
    title: 'Ping',
    description:
      'Проверка связи с MCP-сервером Tropa. Возвращает "pong" и текущее местное время сервера.',
    inputSchema: {},
  },
  async () => {
    const now = new Date();
    const payload = {
      reply: 'pong',
      time: now.toLocaleString('ru-RU'),
      iso: now.toISOString(),
      server: 'tropa-probe 0.1.0',
      pid: process.pid,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  },
);

// stdout занят протоколом MCP — любые свои сообщения только в stderr.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[tropa-probe] MCP server ready on stdio');

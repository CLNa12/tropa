// Tropa — этап 2. MCP-сервер со всеми инструментами раздела 7 PRD.
// Транспорт stdio, официальный SDK. Данные берутся и пишутся только через API этапа 1.
// Сам список инструментов — в tools.js, доступ к API — в api.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools.js';

export const VERSION = '0.2.0';

export function buildServer() {
  const server = new McpServer({ name: 'tropa', version: VERSION });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input },
      async (args) => {
        try {
          const result = await tool.run(args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
        } catch (err) {
          // Ошибку возвращаем агенту текстом, а не падаем: он должен прочитать её и исправиться.
          return { isError: true, content: [{ type: 'text', text: err.message }] };
        }
      },
    );
  }
  return server;
}

/** Запуск как самостоятельного процесса; при импорте из check.js ничего не происходит. */
if (process.env.TROPA_MCP_NO_AUTOSTART !== '1') {
  // stdout занят протоколом MCP — любые свои сообщения только в stderr.
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
  console.error(`[tropa] MCP server ${VERSION} ready on stdio · инструментов: ${tools.length}`);
}

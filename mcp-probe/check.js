// Самопроверка этапа 0: поднимает server.js как дочерний процесс по stdio,
// запрашивает список инструментов и вызывает ping. Запуск: npm run check
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, 'server.js')],
});

const client = new Client({ name: 'tropa-probe-check', version: '0.1.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('инструменты:', tools.map((t) => t.name).join(', '));

const result = await client.callTool({ name: 'ping', arguments: {} });
console.log('ответ ping:');
console.log(result.content[0].text);

await client.close();

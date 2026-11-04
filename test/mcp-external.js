// Проверка второго режима: API уже запущен отдельно (`npm start`), и MCP должен ходить в него,
// а не поднимать свой. Это режим, в котором агент и браузер работают с одной картой.
// Работает на временной папке. Запуск: npm run mcp:check:external
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sandbox = mkdtempSync(join(tmpdir(), 'tropa-ext-'));
const PORT = '4399'; // отдельный порт, чтобы не мешать настоящему серверу на 4317

process.env.TROPA_HOME = sandbox;
process.env.TROPA_PORT = PORT;

const { createServer } = await import('../server/index.js');
const listener = createServer().listen(Number(PORT), '127.0.0.1');
await new Promise((done) => listener.once('listening', done));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'mcp', 'server.js')],
  env: { ...process.env, TROPA_HOME: sandbox, TROPA_PORT: PORT },
});
const client = new Client({ name: 'tropa-mcp-external-check', version: '0.2.0' });
await client.connect(transport);

const parse = async (name, args = {}) =>
  JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const pong = await parse('ping');
const made = await parse('create_roadmap', { title: 'создано через MCP' });
const seen = await (await fetch(`http://127.0.0.1:${PORT}/api/roadmaps`)).json();

const checks = [
  ['MCP нашёл уже запущенный API', pong.api?.mode === 'external', pong.api?.mode],
  ['MCP ходит на правильный порт', pong.api?.port === Number(PORT), String(pong.api?.port)],
  ['карта от MCP видна внешнему API', seen.roadmaps.some((r) => r.id === made.id)],
];

let failed = 0;
for (const [name, ok, details] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && details ? ` — ${details}` : ''}`);
  if (!ok) failed += 1;
}

await client.close().catch(() => {});
listener.close();
rmSync(sandbox, { recursive: true, force: true });

if (failed) process.exit(1);
console.log('режим external работает');

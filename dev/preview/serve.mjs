// Статический сервер для автономного предпросмотра панели (npm run preview).
// Windy тут не участвует — только наш dist/plugin.js + заглушки в index.html.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = 8931;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    try {
        const body = await readFile(join(ROOT, path));
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log(`preview: http://127.0.0.1:${PORT}/dev/preview/index.html?mock=1`);
});

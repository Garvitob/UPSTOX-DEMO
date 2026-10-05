// Serves reference/ (the approved hardcoded design) on http://127.0.0.1:3100 so browsers and the Playwright MCP,
// which blocks file:// URLs, can open it side by side with the app. Dev-only; not part of the app or the deploy.
// Usage: node scripts/serve-reference.mjs   →  http://127.0.0.1:3100/add-more-check-demo.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('reference');
const port = Number(process.env.PORT || 3100);
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

http
  .createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'add-more-check-demo.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`reference on http://127.0.0.1:${port}/add-more-check-demo.html`));

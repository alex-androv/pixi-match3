import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/** Serves the built client (packages/client/dist) so production runs on a single port. */
export function createStaticHandler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      file = join(root, 'index.html'); // SPA fallback
    }
    try {
      await stat(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Client is not built. Run `npm run build`.');
      return;
    }
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  };
}

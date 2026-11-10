/**
 * Local POS server. Runs on the shop PC, listens on 127.0.0.1 only, keeps all data in
 * a SQLite file, and serves the POS screens. No internet needed for anything here.
 *
 *   POS_PORT      (default 4100)
 *   POS_API_URL   SaaS API for license activation (default http://localhost:3000/api)
 *   POS_DATA_DIR  (default %APPDATA%\SaaS POS on Windows, ~/.saas-pos elsewhere)
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IpcResult } from '../shared/types';
import { openDatabase } from './db/database';
import { createHandlers, type Handlers } from './handlers';
import { PosError } from './services/validate';

const PORT = Number(process.env.POS_PORT ?? 4100);
const HOST = '127.0.0.1';
const VERSION = (JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }).version;
const WEB_DIR = resolve(__dirname, '../../dist-web');
const MAX_BODY = 1_000_000;

function dataDir(): string {
  if (process.env.POS_DATA_DIR) return resolve(process.env.POS_DATA_DIR);
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'SaaS POS');
  return join(homedir(), '.saas-pos');
}

const dir = dataDir();
mkdirSync(dir, { recursive: true });
const db = openDatabase(join(dir, 'pos.sqlite'));
const API_URL = (process.env.POS_API_URL ?? 'http://localhost:3000/api').replace(/\/+$/, '');
const handlers = createHandlers(db, { version: VERSION, apiUrl: API_URL });

// Keep the license token fresh while online. Failures are recorded and ignored:
// the cached token stays valid until it expires, and selling never depends on it.
const REFRESH_EVERY = 6 * 60 * 60 * 1000;
const refresh = () => void handlers['license:refresh']().catch((e) => console.error('[license refresh]', e));
setTimeout(refresh, 5_000).unref();
setInterval(refresh, REFRESH_EVERY).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
};

function send(res: ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, bad) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        bad(new PosError('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', bad);
  });
}

/**
 * Only the POS page itself may call the API. Browsers attach Origin to cross-site
 * requests, so another website open on this PC can't drive the till: requests must come
 * from our own origin (or the Vite dev server) and carry a custom header, which forces a
 * CORS preflight that we never approve.
 */
function isTrustedRequest(req: IncomingMessage): boolean {
  if (req.headers['x-pos-client'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GET/POST from some browsers, or curl on this PC
  const allowed = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, 'http://localhost:5174', 'http://127.0.0.1:5174'];
  return allowed.includes(origin);
}

async function handleRpc(req: IncomingMessage, res: ServerResponse, channel: string) {
  const json = (status: number, body: IpcResult<unknown>) => send(res, status, JSON.stringify(body), 'application/json');
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!isTrustedRequest(req)) return json(403, { ok: false, error: 'Forbidden' });
  const fn = Object.prototype.hasOwnProperty.call(handlers, channel)
    ? (handlers[channel as keyof Handlers] as (...args: unknown[]) => unknown)
    : undefined;
  if (!fn) return json(404, { ok: false, error: `Unknown operation: ${channel}` });

  try {
    const raw = await readBody(req);
    const args = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(args)) throw new PosError('Arguments must be an array');
    const data = await fn(...args);
    json(200, { ok: true, data: data === undefined ? null : data });
  } catch (err) {
    if (err instanceof PosError) return json(200, { ok: false, error: err.message });
    if (err instanceof SyntaxError) return json(400, { ok: false, error: 'Invalid JSON' });
    console.error(`[rpc ${channel}]`, err);
    json(500, { ok: false, error: 'Something went wrong. Details were written to the server log.' });
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!existsSync(WEB_DIR)) {
    return send(res, 503, 'POS screens are not built yet. Run: npm run build:web -w @pos/pos', 'text/plain; charset=utf-8');
  }
  // Resolve inside WEB_DIR only (no ../ escapes); unknown paths fall back to index.html.
  let file = normalize(join(WEB_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB_DIR + sep) && file !== WEB_DIR) return send(res, 400, 'Bad path', 'text/plain');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIR, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': type, ...SECURITY_HEADERS };
  headers['Cache-Control'] = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-store';
  if (type.startsWith('text/html')) {
    headers['Content-Security-Policy'] =
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'";
  }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${HOST}`);
  if (pathname.startsWith('/rpc/')) {
    void handleRpc(req, res, pathname.slice('/rpc/'.length));
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname);
  } else {
    send(res, 405, 'Method not allowed', 'text/plain');
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is the POS already running?`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`SaaS POS v${VERSION} running at http://localhost:${PORT}`);
  console.log(`Data: ${join(dir, 'pos.sqlite')}`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

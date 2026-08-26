#!/usr/bin/env node
/** Simpele statische server voor lokaal bekijken: node scripts/serve.mjs [poort] */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/paths.mjs';

const port = Number.parseInt(process.argv[2] ?? '', 10) || 8080;
const siteDir = path.join(ROOT, 'site');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(siteDir, rel.endsWith('/') ? `${rel}index.html` : rel);
  if (!file.startsWith(siteDir)) {
    res.writeHead(403).end('Verboden');
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Niet gevonden');
  }
}).listen(port, () => console.log(`Site draait op http://localhost:${port}`));

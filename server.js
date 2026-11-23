#!/usr/bin/env node
// Server HTTP senza dipendenze: serve la pagina in /public e le notizie aggregate su /api/news.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { aggregate } = require('./lib/aggregator');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_MINUTES = Number(process.env.CACHE_MINUTES) || 10;
const PUBLIC_DIR = path.join(__dirname, 'public');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));

let cache = null;
const imageCache = new Map(); // link → immagine, per non riscaricare le pagine degli articoli
let cacheTime = 0;
let pending = null;

async function getNews(force = false) {
  const fresh = cache && Date.now() - cacheTime < CACHE_MINUTES * 60_000;
  if (fresh && !force) return cache;
  if (!pending) {
    if (imageCache.size > 5000) imageCache.clear();
    pending = aggregate(config, { imageCache })
      .then((data) => {
        cache = data;
        cacheTime = Date.now();
        console.log(`[${new Date().toLocaleTimeString('it-IT')}] ${data.items.length} notizie, ${data.errors.length} feed non raggiungibili`);
        return data;
      })
      .finally(() => (pending = null));
  }
  return pending;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Non trovato');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/news') {
    try {
      const data = await getNews(url.searchParams.has('refresh'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`AggregaNotizie in ascolto su http://localhost:${PORT}`);
  getNews().catch((e) => console.error('Primo caricamento fallito:', e));
});

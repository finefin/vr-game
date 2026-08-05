// Local dev server: the game, the editor, and the write API.
//
//   npm run dev   ->  http://127.0.0.1:8000        the game (same paths as dist/)
//                     http://127.0.0.1:8000/editor/ the beatmap editor
//
// It writes to beatmaps/, so it binds to loopback only and refuses any path
// that escapes that folder.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { analyzeFile } = require('./analyzer.js');
const manifest = require('./manifest.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SHARED = path.join(ROOT, 'shared');
const BEATMAPS = path.join(ROOT, 'beatmaps');
const EDITOR = path.join(__dirname, 'editor');

const PORT = Number(process.env.PORT) || 8000;
const HOST = '127.0.0.1';
const AUDIO_EXT = ['.mp3', '.ogg', '.wav', '.m4a', '.flac'];
const MAX_UPLOAD = 60 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Resolve a URL path under `base`, refusing anything that climbs out of it.
function safeJoin(base, rel) {
  const full = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function serveStatic(res, base, rel) {
  let file = safeJoin(base, decodeURIComponent(rel));
  if (!file) { res.writeHead(403); res.end('forbidden'); return; }
  let stat = fs.existsSync(file) && fs.statSync(file);
  if (stat && stat.isDirectory()) {
    file = path.join(file, base === EDITOR ? 'editor.html' : 'index.html');
    stat = fs.existsSync(file) && fs.statSync(file);
  }
  if (!stat || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Only ever a bare filename directly inside beatmaps/.
function beatmapPath(name, allowedExt) {
  if (typeof name !== 'string' || !name || name !== path.basename(name)) return null;
  if (allowedExt && !allowedExt.includes(path.extname(name).toLowerCase())) return null;
  return safeJoin(BEATMAPS, name);
}

async function handleApi(req, res, url) {
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST only' });

  if (url.pathname === '/api/analyze') {
    const body = JSON.parse((await readBody(req, 1 << 20)).toString('utf8'));
    const file = beatmapPath(body.audio, AUDIO_EXT);
    if (!file || !fs.existsSync(file)) return sendJSON(res, 400, { error: 'unknown audio file' });
    console.log('[api] analyzing ' + body.audio);
    const chart = await analyzeFile(file);
    console.log('[api] -> ' + chart.notes.length + ' notes (' + chart.system + ')');
    return sendJSON(res, 200, chart);
  }

  if (url.pathname === '/api/beatmap') {
    const body = JSON.parse((await readBody(req, 8 << 20)).toString('utf8'));
    const file = beatmapPath(body.file, ['.json']);
    if (!file) return sendJSON(res, 400, { error: 'bad filename' });
    const chart = body.chart;
    if (!chart || !Array.isArray(chart.notes)) return sendJSON(res, 400, { error: 'bad chart' });
    // Keep the previous version alongside the new one. Overwriting a chart is
    // the one destructive thing this server does, and the editor's undo history
    // is gone once the page reloads.
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    fs.writeFileSync(file, JSON.stringify({ bpm: chart.bpm || 0, notes: chart.notes }, null, 2) + '\n');
    const demos = manifest.regenerate(BEATMAPS);
    console.log('[api] saved ' + body.file + ' (' + chart.notes.length + ' notes)');
    return sendJSON(res, 200, { file: path.basename(file), demos: demos.length });
  }

  if (url.pathname === '/api/song') {
    const file = beatmapPath(url.searchParams.get('name'), AUDIO_EXT);
    if (!file) return sendJSON(res, 400, { error: 'bad audio filename' });
    const data = await readBody(req, MAX_UPLOAD);
    if (!data.length) return sendJSON(res, 400, { error: 'empty upload' });
    fs.writeFileSync(file, data);
    manifest.regenerate(BEATMAPS);
    console.log('[api] added ' + path.basename(file) + ' (' + Math.round(data.length / 1024) + ' KB)');
    return sendJSON(res, 200, { audio: path.basename(file) });
  }

  return sendJSON(res, 404, { error: 'no such endpoint' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + HOST);
  const p = url.pathname;

  const done = (promise) => promise.catch((e) => {
    console.error('[api] ' + e.message);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
    else res.end();
  });

  if (p.startsWith('/api/')) return done(handleApi(req, res, url));
  if (p === '/editor') { res.writeHead(302, { Location: '/editor/' }); return res.end(); }
  if (p.startsWith('/editor/')) return serveStatic(res, EDITOR, p.slice('/editor'.length));
  if (p.startsWith('/beatmaps/')) return serveStatic(res, BEATMAPS, p.slice('/beatmaps'.length));
  if (p.startsWith('/shared/')) return serveStatic(res, SHARED, p.slice('/shared'.length));
  return serveStatic(res, SRC, p);
});

server.listen(PORT, HOST, () => {
  console.log('game    http://' + HOST + ':' + PORT + '/');
  console.log('editor  http://' + HOST + ':' + PORT + '/editor/');
});

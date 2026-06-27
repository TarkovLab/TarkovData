const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const MAPS_DIR = path.join(__dirname, 'maps');

const MIME_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function resolvePath(pathname) {
  // Try data/ first, then maps/
  const inData = path.join(DATA_DIR, pathname);
  if (fs.existsSync(inData) && !fs.statSync(inData).isDirectory()) return inData;

  const inMaps = path.join(MAPS_DIR, pathname);
  if (fs.existsSync(inMaps) && !fs.statSync(inMaps).isDirectory()) return inMaps;

  return null;
}

function serveIndex(res) {
  // Build a simple JSON index of all available files
  const files = [];

  function walk(dir, base) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else files.push(rel);
    }
  }

  walk(DATA_DIR, '');
  walk(MAPS_DIR, 'maps');

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify({ server: 'data.tarkovlab.org', files }, null, 2));
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // Serve favicon – redirect to TarkovLab logo CDN
  if (pathname === '/favicon.ico') {
    res.writeHead(302, { Location: 'https://logo.tarkovlab.org/tl-icon' });
    res.end();
    return;
  }

  // Serve index at /
  if (pathname === '/' || pathname === '') {
    serveIndex(res);
    return;
  }

  const filePath = resolvePath(pathname);

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File Not Found', path: pathname }));
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TarkovData server running on port ${PORT}`);
  console.log(`Data :  ${DATA_DIR}`);
  console.log(`Maps :  ${MAPS_DIR}`);
  console.log(`Index:  http://localhost:${PORT}/`);
  console.log(`Quests: http://localhost:${PORT}/quests.json`);
});

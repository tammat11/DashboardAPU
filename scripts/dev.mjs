import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/task-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

// Load .env variables manually since we don't have dotenv dependency
try {
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = await fs.readFile(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalIdx = trimmed.indexOf('=');
    if (equalIdx > 0) {
      const key = trimmed.slice(0, equalIdx).trim();
      let val = trimmed.slice(equalIdx + 1).trim();
      // remove quotes if any
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
} catch (err) {
  console.log('No .env file found or failed to load. Running with system environment variables.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  // Route API
  if (url.pathname === '/api/task-report') {
    // mock req.query
    req.query = Object.fromEntries(url.searchParams.entries());
    
    // mock res.status, res.json, res.setHeader
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error('API execution error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: err.message || 'API error' }));
    }
    return;
  }
  
  // Route static files
  let filename = url.pathname === '/' ? 'index.html' : url.pathname;
  let filePath = path.join(__dirname, '..', 'public', filename);
  
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    let contentType = 'text/html; charset=utf-8';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.js') contentType = 'application/javascript';
    if (ext === '.png') contentType = 'image/png';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Local server is running at: http://localhost:${PORT}\n`);
});

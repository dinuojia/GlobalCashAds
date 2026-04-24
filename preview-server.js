'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5500;
const MAX_PORT_RETRIES = 30;
const parsedPort = Number.parseInt(process.argv[2], 10);
const requestedPort = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
const root = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const sendText = (res, statusCode, message, headers = {}) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...NO_CACHE_HEADERS,
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(message);
};

const resolveRequestPath = (url = '/') => {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(url, `http://${HOST}`).pathname);
  } catch {
    return null;
  }

  const normalizedPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const resolvedPath = path.resolve(root, `.${normalizedPath}`);
  const relativePath = path.relative(root, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolvedPath;
};

const createHeaders = (filePath, size) => {
  const ext = path.extname(filePath).toLowerCase();
  return {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': size,
    ...NO_CACHE_HEADERS,
    ...SECURITY_HEADERS,
  };
};

const handleRequest = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  const filePath = resolveRequestPath(req.url || '/');
  if (!filePath) {
    return sendText(res, 403, 'Forbidden');
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return sendText(res, 404, 'Not Found');
  }

  if (!stat.isFile()) {
    return sendText(res, 404, 'Not Found');
  }

  res.writeHead(200, createHeaders(filePath, stat.size));

  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      return sendText(res, 500, 'Internal Server Error');
    }
    res.destroy();
  });

  stream.pipe(res);
};

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    sendText(res, 500, 'Internal Server Error');
  });
});

let currentPort = requestedPort;
let retryCount = 0;

const logServerReady = (port) => {
  console.log(`Task Portal preview running at:`);
  console.log(`- http://${HOST}:${port}/index.html`);
  console.log(`- http://localhost:${port}/index.html`);
};

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE' && retryCount < MAX_PORT_RETRIES) {
    retryCount += 1;
    currentPort += 1;
    console.warn(`Port ${currentPort - 1} is busy, retrying on ${currentPort}...`);
    server.listen(currentPort, HOST);
    return;
  }

  if (error && error.code === 'EADDRINUSE') {
    console.error(
      `Failed to start preview server: no available port in range ${requestedPort}-${currentPort}.`
    );
  } else {
    console.error('Failed to start preview server:', error && error.message ? error.message : error);
  }

  process.exit(1);
});

server.listen(currentPort, HOST, () => {
  logServerReady(currentPort);
});

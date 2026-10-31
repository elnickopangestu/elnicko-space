const http = require('http');
const crypto = require('crypto');

const PORT = process.env.AGENT_PORT || 4000;
const TOKEN = process.env.VPS_TOKEN;

if (!TOKEN || TOKEN.length < 16) {
  console.error('[AGENT] VPS_TOKEN wajib diisi (minimal 16 karakter)');
  process.exit(1);
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function authorized(header = '') {
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${TOKEN}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (!authorized(req.headers.authorization)) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const domain = decodeURIComponent(url.pathname.split('/').pop());

  if (!DOMAIN_RE.test(domain)) {
    return send(res, 400, { error: 'Invalid domain' });
  }

  console.log(`[AGENT] ${req.method} ${url.pathname}`);

  // Simulate deploy (no shell execution)
  send(res, 200, { success: true, domain, output: `Deploying ${domain}...` });
});

// Hanya listen di localhost; akses publik lewat cloudflared tunnel
server.listen(PORT, '127.0.0.1', () =>
  console.log(`[ELNICKO SPACE AGENT] Running on 127.0.0.1:${PORT}`)
);

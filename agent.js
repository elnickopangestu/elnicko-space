const http = require('http');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sites = require('./agent-sites');

const PORT = process.env.AGENT_PORT || 4000;
const TOKEN = process.env.VPS_TOKEN;

if (!TOKEN || TOKEN.length < 16) {
  console.error('[AGENT] VPS_TOKEN wajib diisi (minimal 16 karakter)');
  process.exit(1);
}

// Proses pm2 yang tidak boleh dikontrol dari dashboard (agent sendiri + tunnel)
const PROTECTED = new Set(
  (process.env.PROTECTED_APPS || 'elnicko-agent,elnicko-tunnel').split(',').map(s => s.trim()).filter(Boolean)
);
const ACTIONS = new Set(['restart', 'stop', 'start']);

function authorized(header = '') {
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${TOKEN}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().slice(0, 300)));
      resolve(stdout);
    });
  });
}

async function pm2List() {
  const out = await run('pm2', ['jlist']);
  const start = out.indexOf('[');
  const list = JSON.parse(out.slice(start));
  return list.map(p => ({
    name: p.name,
    status: p.pm2_env?.status,
    cpu: p.monit?.cpu ?? 0,
    memory: p.monit?.memory ?? 0,
    restarts: p.pm2_env?.restart_time ?? 0,
    uptime: p.pm2_env?.status === 'online' ? Date.now() - p.pm2_env.pm_uptime : 0,
    protected: PROTECTED.has(p.name),
  }));
}

function cpuTimes() {
  return os.cpus().reduce((a, c) => {
    const t = Object.values(c.times).reduce((x, y) => x + y, 0);
    return { idle: a.idle + c.times.idle, total: a.total + t };
  }, { idle: 0, total: 0 });
}

async function cpuPercent() {
  const a = cpuTimes();
  await new Promise(r => setTimeout(r, 300));
  const b = cpuTimes();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 100) : 0;
}

async function diskInfo() {
  const s = await fs.promises.statfs('/');
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { total, used: total - free };
}

async function status() {
  return {
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuPercent: await cpuPercent(),
    memory: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    disk: await diskInfo(),
    uptime: os.uptime(),
    load: os.loadavg(),
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 10000) { reject(new sites.HttpError(413, 'Body terlalu besar')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new sites.HttpError(400, 'JSON tidak valid')); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req.headers.authorization)) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  console.log(`[AGENT] ${req.method} ${url.pathname}`);

  try {
    // GET /status
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'status') {
      return send(res, 200, await status());
    }

    // GET /overview (status + apps dalam satu request)
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'overview') {
      const [s, apps] = await Promise.all([status(), pm2List()]);
      return send(res, 200, { status: s, apps });
    }

    // GET /apps
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'apps') {
      return send(res, 200, { apps: await pm2List() });
    }

    // POST /apps/:name/:action
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'apps') {
      const name = decodeURIComponent(parts[1]);
      const action = parts[2];
      if (!ACTIONS.has(action)) return send(res, 400, { error: 'Invalid action' });
      if (PROTECTED.has(name)) return send(res, 403, { error: 'App ini dilindungi' });

      // Nama harus ada di daftar pm2, tidak diteruskan mentah dari input
      const apps = await pm2List();
      if (!apps.some(a => a.name === name)) return send(res, 404, { error: 'App tidak ditemukan' });

      await run('pm2', [action === 'start' ? 'restart' : action, name]);
      return send(res, 200, { success: true, name, action, apps: await pm2List() });
    }

    // ---- Websites ----
    if (parts[0] === 'sites') {
      if (req.method === 'GET' && parts.length === 1) return send(res, 200, { sites: await sites.listSites() });
      if (req.method === 'POST' && parts.length === 1) {
        const job = await sites.createSite(await readJson(req));
        return send(res, 202, { job: job.id });
      }
      if (req.method === 'POST' && parts.length === 2 && parts[1] === 'import') {
        const job = await sites.importSite(await readJson(req));
        return send(res, 202, { job: job.id });
      }
      if (parts.length >= 2) {
        const domain = decodeURIComponent(parts[1]);
        const op = parts[2];
        if (req.method === 'GET' && op === 'logs') return send(res, 200, await sites.siteLogs(domain));
        if (req.method === 'POST' && ['deploy', 'ssl', 'delete'].includes(op)) {
          const fn = { deploy: sites.deploySite, ssl: sites.enableSsl, delete: sites.deleteSite }[op];
          return send(res, 202, { job: fn(domain).id });
        }
        if (req.method === 'POST' && ['start', 'stop', 'restart'].includes(op)) {
          return send(res, 200, await sites.controlSite(domain, op));
        }
      }
    }

    // GET /jobs/:id
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'jobs') {
      const j = sites.getJob(parts[1]);
      return send(res, 200, { id: j.id, domain: j.domain, title: j.title, status: j.status, log: j.log, startedAt: j.startedAt, endedAt: j.endedAt });
    }

    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[AGENT] error:', e.message);
    send(res, e.status || 500, { error: e.message });
  }
});

// Hanya listen di localhost; akses publik lewat cloudflared tunnel
server.listen(PORT, '127.0.0.1', () =>
  console.log(`[ELNICKO SPACE AGENT] Running on 127.0.0.1:${PORT}`)
);

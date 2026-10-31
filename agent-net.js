// Deteksi alamat akses tiap proses pm2: port yang di-listen proses (+ anaknya) dicocokkan dengan route nginx.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./agent-sites');

const NGINX_ENABLED = process.env.NGINX_ENABLED_DIR || '/etc/nginx/sites-enabled';

function publicIp() {
  if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP;
  const all = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address)
    .filter(a => !a.startsWith('172.17.') && !a.startsWith('10.') && !a.startsWith('192.168.'));
  return all[0] || null;
}

// port -> Set(pid)
async function listeningPorts() {
  const map = new Map();
  let out = '';
  try { out = await run('ss', ['-ltnpH'], { timeout: 5000 }); } catch { return map; }
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[3];
    const port = Number(local.slice(local.lastIndexOf(':') + 1));
    if (!port) continue;
    if (!map.has(port)) map.set(port, new Set());
    for (const m of line.matchAll(/pid=(\d+)/g)) map.get(port).add(Number(m[1]));
  }
  return map;
}

// ppid -> [pid]
async function childMap() {
  const kids = new Map();
  try {
    const out = await run('ps', ['-eo', 'pid=,ppid='], { timeout: 5000 });
    for (const l of out.split('\n')) {
      const [pid, ppid] = l.trim().split(/\s+/).map(Number);
      if (!pid) continue;
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(pid);
    }
  } catch { /* abaikan */ }
  return kids;
}

function descendants(root, kids) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    (kids.get(p) || []).forEach(c => stack.push(c));
  }
  return seen;
}

// Satu entri per file di sites-enabled
function nginxRoutes() {
  let files = [];
  try { files = fs.readdirSync(NGINX_ENABLED); } catch { return []; }
  const routes = [];
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(NGINX_ENABLED, f), 'utf8'); } catch { continue; }
    const names = new Set();
    for (const m of txt.matchAll(/server_name\s+([^;]+);/g)) m[1].trim().split(/\s+/).forEach(n => names.add(n));
    const listens = [...txt.matchAll(/listen\s+(?:\[::\]:|[\d.]+:)?(\d+)([^;]*);/g)].map(m => ({ port: Number(m[1]), ssl: /\bssl\b/.test(m[2]) }));
    const proxyPorts = [...txt.matchAll(/proxy_pass\s+https?:\/\/127\.0\.0\.1:(\d+)/g)].map(m => Number(m[1]));
    routes.push({ names: [...names].filter(n => n !== '_'), listens, proxyPorts, auth: /auth_basic\s+"/.test(txt) });
  }
  return routes;
}

function routeUrl(r, ip) {
  const hasSsl = r.listens.some(l => l.ssl);
  if (r.names.length) return `${hasSsl ? 'https' : 'http'}://${r.names[0]}`;
  const l = r.listens.find(x => !x.ssl) || r.listens[0];
  return l && ip ? `http://${ip}:${l.port}` : null;
}

// procs: [{ name, pid }] -> { [name]: { urls: [{url, secure, auth}], ports: [] } }
async function discover(procs) {
  const [ports, kids] = await Promise.all([listeningPorts(), childMap()]);
  const routes = nginxRoutes();
  const ip = publicIp();
  const result = {};
  for (const p of procs) {
    if (!p.pid) { result[p.name] = { urls: [], ports: [] }; continue; }
    const tree = descendants(p.pid, kids);
    const mine = [...ports].filter(([, pids]) => [...pids].some(x => tree.has(x))).map(([port]) => port);
    const urls = [];
    for (const r of routes) {
      if (!r.proxyPorts.some(pp => mine.includes(pp))) continue;
      const url = routeUrl(r, ip);
      if (url && !urls.some(u => u.url === url)) urls.push({ url, secure: url.startsWith('https://'), auth: r.auth });
    }
    result[p.name] = { urls, ports: mine };
  }
  return result;
}

module.exports = { discover, publicIp };

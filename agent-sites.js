// Manajemen website di VPS: clone repo, build, pm2, nginx, SSL.
// Semua perintah dijalankan lewat spawn(args) tanpa shell; nilai dari input divalidasi ketat.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { authEnv } = require('./agent-github');
const { spawn } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/elnicko';
const WWW = process.env.SITES_DIR || '/var/www';
const REGISTRY = path.join(DATA_DIR, 'sites.json');
const NGINX_AVAIL = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';
const CERT_EMAIL = process.env.CERTBOT_EMAIL || '';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,63}$/;
const FRAMEWORKS = new Set(['nextjs', 'node', 'static']);
const PORT_MIN = 3100;
const PORT_MAX = 3999;
const RESERVED_PORTS = new Set([3000, 4000]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- registry ----------
function load() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return {}; }
}
function save(reg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${REGISTRY}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, REGISTRY);
}

const dirOf = (domain) => path.join(WWW, domain);
const pm2Name = (domain) => `site-${domain}`;
// App eksternal (diimpor) memakai nama proses pm2 yang sudah ada
const procName = (site) => site.pm2 || pm2Name(site.domain);
const PM2_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PROTECTED = new Set((process.env.PROTECTED_APPS || 'elnicko-agent,elnicko-tunnel').split(',').map(x => x.trim()).filter(Boolean));

function normDomain(d) {
  const domain = String(d || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) throw new HttpError(400, 'Domain tidak valid');
  return domain;
}

// ---------- jobs ----------
const jobs = new Map();
const LOG_CAP = 30000;

function startJob(domain, title, fn) {
  for (const j of jobs.values()) {
    if (j.domain === domain && j.status === 'running') {
      throw new HttpError(409, `Masih ada proses berjalan untuk ${domain}`);
    }
  }
  const job = { id: crypto.randomBytes(6).toString('hex'), domain, title, status: 'running', log: '', startedAt: Date.now(), endedAt: null };
  jobs.set(job.id, job);
  if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
  Promise.resolve()
    .then(() => fn(job))
    .then(() => { job.status = 'done'; })
    .catch((e) => { job.status = 'failed'; append(job, `\n❌ ${e.message}\n`); })
    .finally(() => { job.endedAt = Date.now(); });
  return job;
}

function append(job, text) {
  job.log += text;
  if (job.log.length > LOG_CAP) job.log = '…' + job.log.slice(-LOG_CAP);
}

function getJob(id) {
  const j = jobs.get(id);
  if (!j) throw new HttpError(404, 'Job tidak ditemukan');
  return j;
}

// ---------- process helpers ----------
// Rahasia agent tidak boleh bocor ke build/aplikasi website
// Pakai allowlist: env agent berisi variabel internal pm2 dan token yang tidak boleh diwariskan
function cleanEnv(extra = {}) {
  const env = {};
  for (const k of ['HOME', 'LANG', 'USER', 'PM2_HOME']) if (process.env[k]) env[k] = process.env[k];
  env.PATH = `${process.env.PATH || '/usr/bin:/bin'}:/root/.bun/bin`;
  return { ...env, TERM: 'dumb', GIT_TERMINAL_PROMPT: '0', ...extra };
}

function run(cmd, args, { cwd, env, job, timeout = 15 * 60 * 1000, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    if (job) append(job, `$ ${cmd} ${args.join(' ')}\n`);
    const p = spawn(cmd, args, { cwd, env: env || cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); if (job) append(job, d.toString()); };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, timeout);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      if (code === 0 || allowFail) return resolve(out);
      reject(new Error(`${cmd} ${args[0] || ''} gagal (${sig || 'exit ' + code})`));
    });
  });
}

async function pm2Status() {
  try {
    const out = await run('pm2', ['jlist']);
    const list = JSON.parse(out.slice(out.indexOf('[')));
    return Object.fromEntries(list.map(p => [p.name, { status: p.pm2_env?.status, cpu: p.monit?.cpu ?? 0, memory: p.monit?.memory ?? 0, restarts: p.pm2_env?.restart_time ?? 0, uptime: p.pm2_env?.status === 'online' ? Date.now() - p.pm2_env.pm_uptime : 0 }]));
  } catch { return {}; }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = require('net').createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port, '127.0.0.1');
  });
}

async function pickPort(reg, wanted) {
  const used = new Set(Object.values(reg).map(s => s.port).filter(Boolean));
  if (wanted != null && wanted !== '') {
    const p = Number(wanted);
    if (!Number.isInteger(p) || p < 1024 || p > 65535 || RESERVED_PORTS.has(p)) throw new HttpError(400, 'Port tidak valid');
    if (used.has(p) || await portInUse(p)) throw new HttpError(409, `Port ${p} sudah dipakai`);
    return p;
  }
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!used.has(p) && !(await portInUse(p))) return p;
  }
  throw new HttpError(507, 'Tidak ada port kosong');
}

// ---------- nginx ----------
const HTPASSWD_DIR = '/etc/nginx/htpasswd';
const htpasswdPath = (domain) => path.join(HTPASSWD_DIR, domain);

// Format {SSHA} (SHA1 + salt) didukung nginx tanpa tool tambahan
function ssha(password) {
  const salt = crypto.randomBytes(8);
  const digest = crypto.createHash('sha1').update(password).update(salt).digest();
  return '{SSHA}' + Buffer.concat([digest, salt]).toString('base64');
}

function writeHtpasswd(domain, user, password) {
  fs.mkdirSync(HTPASSWD_DIR, { recursive: true, mode: 0o750 });
  fs.writeFileSync(htpasswdPath(domain), `${user}:${ssha(password)}\n`, { mode: 0o640 });
  // Worker nginx (www-data) harus bisa membaca file ini
  try {
    const gid = Number((fs.readFileSync('/etc/group', 'utf8').split('\n').find(l => l.startsWith('www-data:')) || '').split(':')[2]);
    if (gid) fs.chownSync(htpasswdPath(domain), 0, gid);
  } catch { /* abaikan */ }
}

function nginxConf(site) {
  const header = `# dikelola oleh Elnicko Space - jangan edit manual\n`;
  if (site.framework === 'static') {
    return `${header}server {
  listen 80;
  listen [::]:80;
  server_name ${site.domain};
  root ${dirOf(site.domain)};
  index index.html;
  location / { try_files $uri $uri/ =404; }
}
`;
  }
  return `${header}server {
  listen 80;
  listen [::]:80;
  server_name ${site.domain};
  client_max_body_size 25m;${site.auth ? `
  auth_basic "Elnicko Space";
  auth_basic_user_file ${htpasswdPath(site.domain)};` : ''}
  location / {
    proxy_pass http://127.0.0.1:${site.port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
`;
}

async function writeNginx(site, job) {
  const avail = path.join(NGINX_AVAIL, `${site.domain}.conf`);
  const enabled = path.join(NGINX_ENABLED, `${site.domain}.conf`);
  fs.writeFileSync(avail, nginxConf(site));
  try { fs.symlinkSync(avail, enabled); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  try {
    await run('nginx', ['-t'], { job });
  } catch (e) {
    fs.rmSync(enabled, { force: true });
    fs.rmSync(avail, { force: true });
    throw new Error('Konfigurasi nginx ditolak, perubahan dibatalkan');
  }
  await run('systemctl', ['reload', 'nginx'], { job });
}

// ---------- build & run ----------
function readPkg(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; }
}

async function build(site, job) {
  if (site.framework === 'static') return;
  const dir = dirOf(site.domain);
  const pkg = readPkg(dir);
  if (!pkg) throw new Error('package.json tidak ditemukan di repo');
  const env = cleanEnv({ NODE_ENV: 'development', CI: '1' }); // devDependencies dibutuhkan untuk build
  const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
  await run('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: dir, env, job });
  if (pkg.scripts?.build) {
    await run('npm', ['run', 'build'], { cwd: dir, env: cleanEnv({ NODE_ENV: 'production' }), job });
  }
  if (!pkg.scripts?.start) throw new Error('Script "start" tidak ada di package.json');
}

async function startApp(site, job) {
  if (site.framework === 'static') return;
  const name = pm2Name(site.domain);
  await run('pm2', ['delete', name], { job, allowFail: true });
  await run('pm2', ['start', 'npm', '--name', name, '--cwd', dirOf(site.domain), '--', 'start'], {
    job,
    env: cleanEnv({ PORT: String(site.port), NODE_ENV: 'production' }),
  });
  await run('pm2', ['save'], { job, allowFail: true });
}

async function pullLatest(site, job) {
  const dir = dirOf(site.domain);
  await run('git', ['-C', dir, 'fetch', '--depth', '1', 'origin', site.branch], { job, env: authEnv(cleanEnv()) });
  await run('git', ['-C', dir, 'reset', '--hard', 'FETCH_HEAD'], { job });
}

// ---------- operations ----------
async function listSites() {
  const reg = load();
  const pm2 = await pm2Status();
  return Object.values(reg).map(s => ({
    ...s,
    process: s.framework === 'static' ? null : (pm2[procName(s)] || null),
    ssl: fs.existsSync(`/etc/letsencrypt/live/${s.domain}/fullchain.pem`),
    url: `${fs.existsSync(`/etc/letsencrypt/live/${s.domain}/fullchain.pem`) ? 'https' : 'http'}://${s.domain}`,
  })).sort((a, b) => a.createdAt - b.createdAt);
}

async function createSite(input) {
  const domain = normDomain(input.domain);
  const repo = String(input.repo || '').trim().replace(/\.git$/, '');
  if (!REPO_RE.test(repo)) throw new HttpError(400, 'Repo harus URL GitHub publik: https://github.com/user/repo');
  const branch = String(input.branch || 'main').trim();
  if (!BRANCH_RE.test(branch)) throw new HttpError(400, 'Nama branch tidak valid');
  const framework = String(input.framework || '');
  if (!FRAMEWORKS.has(framework)) throw new HttpError(400, 'Framework harus nextjs, node, atau static');

  const reg = load();
  if (reg[domain] || fs.existsSync(dirOf(domain))) throw new HttpError(409, 'Domain sudah terdaftar');
  const port = framework === 'static' ? null : await pickPort(reg, input.port);

  const site = { domain, repo, branch, framework, port, state: 'creating', createdAt: Date.now(), lastDeploy: null };
  reg[domain] = site;
  save(reg);

  return startJob(domain, `Buat ${domain}`, async (job) => {
    const finish = (state) => { const r = load(); if (r[domain]) { r[domain].state = state; if (state === 'ready') r[domain].lastDeploy = Date.now(); save(r); } };
    try {
      fs.mkdirSync(WWW, { recursive: true });
      await run('git', ['clone', '--depth', '1', '--branch', branch, repo, dirOf(domain)], { job, env: authEnv(cleanEnv()) });
      await build(site, job);
      await startApp(site, job);
      await writeNginx(site, job);
      append(job, `\n✅ ${domain} aktif. Arahkan DNS A record ke server ini, lalu klik "Aktifkan SSL".\n`);
      finish('ready');
    } catch (e) {
      finish('failed');
      throw e;
    }
  });
}

// Daftarkan aplikasi yang sudah berjalan di VPS (pm2 + port lokal) agar dapat domain lewat nginx
async function importSite(input) {
  const domain = normDomain(input.domain);
  const pm2 = String(input.pm2 || '').trim();
  if (!PM2_NAME_RE.test(pm2)) throw new HttpError(400, 'Nama proses pm2 tidak valid');
  if (PROTECTED.has(pm2) || pm2.startsWith('site-')) throw new HttpError(400, 'Proses ini tidak bisa diimpor');
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4000) throw new HttpError(400, 'Port tidak valid');

  const procs = await pm2Status();
  if (!procs[pm2]) throw new HttpError(404, 'Proses pm2 tidak ditemukan');
  if (!(await portInUse(port))) throw new HttpError(400, `Tidak ada aplikasi yang listen di port ${port}`);

  const reg = load();
  if (reg[domain] || fs.existsSync(dirOf(domain))) throw new HttpError(409, 'Domain sudah terdaftar');
  const auth = input.auth !== false; // default: dilindungi login nginx
  const site = { domain, repo: '', branch: '', framework: 'external', port, pm2, external: true, auth, state: 'creating', createdAt: Date.now(), lastDeploy: null };
  reg[domain] = site;
  save(reg);

  return startJob(domain, `Import ${domain}`, async (job) => {
    try {
      let password = null;
      if (auth) {
        password = crypto.randomBytes(12).toString('base64url');
        writeHtpasswd(domain, 'admin', password);
      }
      await writeNginx(site, job);
      const r = load(); if (r[domain]) { r[domain].state = 'ready'; save(r); }
      append(job, `\n✅ ${domain} -> 127.0.0.1:${port} (${pm2}). Arahkan DNS A record ke server ini, lalu klik SSL.\n`);
      if (password) append(job, `🔐 Login nginx untuk ${domain}: user "admin", password "${password}" (simpan sekarang, tidak ditampilkan lagi)\n`);
      else append(job, `⚠️ ${domain} dibuka TANPA login nginx. Pastikan aplikasinya punya login sendiri.\n`);
    } catch (e) {
      const r = load(); delete r[domain]; save(r);
      fs.rmSync(htpasswdPath(domain), { force: true });
      throw e;
    }
  });
}

function getSite(domainRaw) {
  const domain = normDomain(domainRaw);
  const site = load()[domain];
  if (!site) throw new HttpError(404, 'Website tidak ditemukan');
  return site;
}

function deploySite(domainRaw) {
  const site = getSite(domainRaw);
  if (site.external) throw new HttpError(400, 'App eksternal dikelola di luar dashboard, tidak bisa di-deploy dari sini');
  if (site.source === 'upload' && !site.repo) throw new HttpError(400, 'Website ini dari upload folder tanpa repo GitHub. Gunakan "Upload ulang" untuk memperbarui.');
  return startJob(site.domain, `Deploy ${site.domain}`, async (job) => {
    await pullLatest(site, job);
    await build(site, job);
    if (site.framework !== 'static') {
      const name = pm2Name(site.domain);
      const status = (await pm2Status())[name];
      if (status) await run('pm2', ['restart', name, '--update-env'], { job, env: cleanEnv({ PORT: String(site.port), NODE_ENV: 'production' }) });
      else await startApp(site, job);
    }
    const r = load();
    if (r[site.domain]) { r[site.domain].lastDeploy = Date.now(); r[site.domain].state = 'ready'; save(r); }
    append(job, `\n✅ ${site.domain} berhasil di-deploy\n`);
  });
}

function localIPv4() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

function enableSsl(domainRaw) {
  const site = getSite(domainRaw);
  return startJob(site.domain, `SSL ${site.domain}`, async (job) => {
    let resolved = [];
    try { resolved = await dns.resolve4(site.domain); } catch { /* belum ada record */ }
    const mine = localIPv4();
    append(job, `DNS ${site.domain} -> ${resolved.join(', ') || '(tidak ada)'}; server: ${mine.join(', ')}\n`);
    if (!resolved.some(ip => mine.includes(ip))) {
      throw new Error('DNS A record domain belum mengarah ke IP server ini. Atur DNS dulu, tunggu propagasi, lalu coba lagi.');
    }
    const args = ['--nginx', '-d', site.domain, '--non-interactive', '--agree-tos', '--redirect'];
    args.push(...(CERT_EMAIL ? ['-m', CERT_EMAIL] : ['--register-unsafely-without-email']));
    await run('certbot', args, { job });
    append(job, `\n✅ SSL aktif untuk ${site.domain}\n`);
  });
}

async function controlSite(domainRaw, action) {
  const site = getSite(domainRaw);
  if (site.framework === 'static') throw new HttpError(400, 'Website static tidak punya proses');
  if (!['start', 'stop', 'restart'].includes(action)) throw new HttpError(400, 'Aksi tidak valid');
  // 'pm2 start <nama>' gagal untuk nama bertitik; restart juga menghidupkan proses yang berhenti
  await run('pm2', [action === 'start' ? 'restart' : action, procName(site)]);
  return { success: true };
}

async function siteLogs(domainRaw) {
  const site = getSite(domainRaw);
  if (site.framework === 'static') return { logs: 'Website static: tidak ada log aplikasi.' };
  const out = await run('pm2', ['logs', procName(site), '--nostream', '--lines', '80', '--raw'], { allowFail: true });
  return { logs: out.slice(-20000) };
}

function deleteSite(domainRaw) {
  const site = getSite(domainRaw);
  return startJob(site.domain, site.external ? `Lepas ${site.domain}` : `Hapus ${site.domain}`, async (job) => {
    const dir = dirOf(site.domain);
    // App eksternal: hanya konfigurasi nginx + registry yang dihapus, proses dan file aplikasi tidak disentuh
    if (!site.external) {
      if (path.dirname(dir) !== path.resolve(WWW) || path.basename(dir) !== site.domain) throw new Error('Path tidak aman, dibatalkan');
      if (site.framework !== 'static') await run('pm2', ['delete', pm2Name(site.domain)], { job, allowFail: true });
    }
    fs.rmSync(path.join(NGINX_ENABLED, `${site.domain}.conf`), { force: true });
    fs.rmSync(path.join(NGINX_AVAIL, `${site.domain}.conf`), { force: true });
    fs.rmSync(htpasswdPath(site.domain), { force: true });
    await run('nginx', ['-t'], { job, allowFail: true });
    await run('systemctl', ['reload', 'nginx'], { job, allowFail: true });
    if (fs.existsSync(`/etc/letsencrypt/live/${site.domain}`)) {
      await run('certbot', ['delete', '--cert-name', site.domain, '--non-interactive'], { job, allowFail: true });
    }
    if (!site.external) fs.rmSync(dir, { recursive: true, force: true });
    const r = load(); delete r[site.domain]; save(r);
    await run('pm2', ['save'], { job, allowFail: true });
    append(job, site.external
      ? `\n✅ ${site.domain} dilepas dari dashboard (aplikasi ${site.pm2} tetap berjalan)\n`
      : `\n✅ ${site.domain} dihapus\n`);
  });
}

const _i = { load, save, dirOf, pm2Name, procName, build, startApp, writeNginx, pickPort, normDomain, pm2Status, FRAMEWORKS, WWW, DATA_DIR };

module.exports = { _i, startJob, run, append, cleanEnv, HttpError, listSites, createSite, importSite, deploySite, enableSsl, controlSite, siteLogs, deleteSite, getJob };

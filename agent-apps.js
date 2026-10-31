// Maintenance proses pm2 apa pun di VPS: info git, log, update (pull + install + build + restart), hapus.
// Semua perintah lewat spawn(args) tanpa shell; nama proses harus ada di daftar pm2.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { startJob, run, append, cleanEnv, HttpError } = require('./agent-sites');

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PROTECTED = new Set((process.env.PROTECTED_APPS || 'elnicko-agent,elnicko-tunnel').split(',').map(s => s.trim()).filter(Boolean));
const SELF = 'elnicko-agent';

async function pm2Raw() {
  const out = await run('pm2', ['jlist']);
  return JSON.parse(out.slice(out.indexOf('[')));
}

async function findApp(name) {
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Nama proses tidak valid');
  const p = (await pm2Raw()).find(x => x.name === name);
  if (!p) throw new HttpError(404, 'Proses tidak ditemukan');
  return p;
}

const cwdOf = (p) => p.pm2_env?.pm_cwd || p.pm2_env?.cwd || null;

// Proses website buatan dashboard dikelola lewat bagian Websites
function assertNotSite(name) {
  if (name.startsWith('site-')) throw new HttpError(400, 'Website dikelola lewat bagian Websites');
}

async function q(cmd, args, opts = {}) {
  try { return (await run(cmd, args, opts)).trim(); } catch { return ''; }
}

async function gitInfo(cwd, doFetch) {
  if (!cwd) return null;
  const top = await q('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 10000 });
  if (!top || path.resolve(top) !== path.resolve(cwd)) return null; // bukan root repo sendiri

  let fetchError = null;
  if (doFetch) {
    try { await run('git', ['-C', cwd, 'fetch', '--quiet', 'origin'], { timeout: 30000 }); }
    catch (e) { fetchError = e.message.slice(0, 200); }
  }
  const g = (...a) => q('git', ['-C', cwd, ...a], { timeout: 15000 });
  const [branch, commit, subject, date, status, remote, counts] = await Promise.all([
    g('rev-parse', '--abbrev-ref', 'HEAD'),
    g('log', '-1', '--format=%h'),
    g('log', '-1', '--format=%s'),
    g('log', '-1', '--format=%cI'),
    g('status', '--porcelain', '--untracked-files=no'),
    g('remote', 'get-url', 'origin'),
    g('rev-list', '--left-right', '--count', 'HEAD...@{u}'),
  ]);
  const m = counts.match(/^(\d+)\s+(\d+)$/);
  return {
    branch, commit, subject, date,
    dirty: status.length > 0,
    remote: remote.replace(/\/\/[^@/]+@/, '//'), // buang kredensial bila ada
    ahead: m ? Number(m[1]) : null,
    behind: m ? Number(m[2]) : null,
    fetchError,
  };
}

async function appInfo(name) {
  const p = await findApp(name);
  const env = p.pm2_env || {};
  const cwd = cwdOf(p);
  return {
    name,
    status: env.status,
    pid: p.pid || null,
    cwd,
    script: env.pm_exec_path || null,
    restarts: env.restart_time ?? 0,
    uptime: env.status === 'online' ? Date.now() - env.pm_uptime : 0,
    cpu: p.monit?.cpu ?? 0,
    memory: p.monit?.memory ?? 0,
    protected: PROTECTED.has(name),
    git: await gitInfo(cwd, true),
  };
}

async function appLogs(name) {
  await findApp(name);
  const out = await run('pm2', ['logs', name, '--nostream', '--lines', '120', '--raw'], { allowFail: true, timeout: 20000 });
  return { logs: out.slice(-24000) };
}

function updateApp(name) {
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Nama proses tidak valid');
  assertNotSite(name);
  return (async () => {
    const p = await findApp(name);
    const cwd = cwdOf(p);
    const git0 = await gitInfo(cwd, false);
    if (!git0) throw new HttpError(400, 'Proses ini bukan repo git, tidak bisa di-update dari sini');

    return startJob(`app:${name}`, `Update ${name}`, async (job) => {
      if (git0.dirty) throw new Error('Ada perubahan lokal yang belum di-commit di VPS. Update dibatalkan agar tidak menimpa pekerjaanmu.');
      const rev = async () => (await run('git', ['-C', cwd, 'rev-parse', 'HEAD'])).trim();
      const before = await rev();
      await run('git', ['-C', cwd, 'fetch', 'origin'], { job, timeout: 60000 });
      await run('git', ['-C', cwd, 'merge', '--ff-only', '@{u}'], { job });
      const after = await rev();
      if (before === after) { append(job, '\n✅ Sudah versi terbaru, tidak ada yang berubah (proses tidak di-restart)\n'); return; }

      const changed = (await run('git', ['-C', cwd, 'diff', '--name-only', before, after])).split('\n').filter(Boolean);
      append(job, `\n${changed.length} file berubah (${before.slice(0, 7)} -> ${after.slice(0, 7)})\n`);

      if (name === SELF) {
        // Agent memperbarui dirinya: cek sintaks dulu, restart ditunda supaya job sempat selesai
        for (const f of ['agent.js', 'agent-sites.js', 'agent-apps.js']) {
          if (fs.existsSync(path.join(cwd, f))) await run(process.execPath, ['--check', path.join(cwd, f)], { job });
        }
        append(job, '\n✅ Kode agent diperbarui. Agent restart sendiri dalam beberapa detik...\n');
        setTimeout(() => {
          spawn('pm2', ['restart', SELF, '--update-env'], { detached: true, stdio: 'ignore', env: cleanEnv() }).unref();
        }, 2500);
        return;
      }

      const pkgFile = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgFile)) {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        const bun = fs.existsSync(path.join(cwd, 'bun.lock')) || fs.existsSync(path.join(cwd, 'bun.lockb'));
        const hasNpmLock = fs.existsSync(path.join(cwd, 'package-lock.json'));
        const env = cleanEnv();
        if (bun) await run('bun', ['install', '--frozen-lockfile'], { cwd, env, job });
        else await run('npm', [hasNpmLock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd, env, job });

        if (fs.existsSync(path.join(cwd, 'prisma', 'schema.prisma'))) {
          await run(bun ? 'bunx' : 'npx', ['prisma', 'generate'], { cwd, env, job });
          if (changed.includes('prisma/schema.prisma')) {
            append(job, '\n⚠️ Schema Prisma berubah. Migrasi database TIDAK dijalankan otomatis; jalankan "prisma db push" manual setelah mengecek backup.\n');
          }
        }
        if (pkg.scripts?.build) await run(bun ? 'bun' : 'npm', ['run', 'build'], { cwd, env, job });
      }

      await run('pm2', ['restart', name], { job });
      append(job, `\n✅ ${name} berhasil di-update dan di-restart\n`);
    });
  })();
}

async function deleteApp(name) {
  const p = await findApp(name);
  assertNotSite(name);
  if (PROTECTED.has(name)) throw new HttpError(403, 'Proses ini dilindungi');
  if (p.pm2_env?.status === 'online') throw new HttpError(400, 'Hentikan proses dulu (Stop) sebelum menghapusnya dari pm2');
  await run('pm2', ['delete', name]);
  await run('pm2', ['save'], { allowFail: true });
  return { success: true };
}

module.exports = { appInfo, appLogs, updateApp, deleteApp, gitInfo, cwdOf, pm2Raw };

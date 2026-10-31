// Upload folder (zip, dikirim per potongan) -> ekstrak -> opsional push ke GitHub -> opsional deploy ke VPS.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sites = require('./agent-sites');
const { githubToken, authEnv, githubStatus, createRepo, REPO_NAME_RE } = require('./agent-github');

const { startJob, run, append, cleanEnv, HttpError, _i } = sites;
const { load, save, dirOf, build, startApp, writeNginx, pickPort, normDomain, pm2Name, pm2Status, FRAMEWORKS, DATA_DIR } = _i;

const UPLOADS = path.join(DATA_DIR, 'uploads');
const MAX_ZIP = 150 * 1024 * 1024;
const MAX_CHUNK = 4.6 * 1024 * 1024;
const MAX_CHUNKS = 80;
const MAX_UNZIPPED = 600 * 1024 * 1024;
const MAX_FILES = 60000;
const ID_RE = /^[a-f0-9]{16}$/;

const upDir = (id) => {
  if (!ID_RE.test(id)) throw new HttpError(400, 'ID upload tidak valid');
  return path.join(UPLOADS, id);
};

function cleanOld() {
  try {
    for (const d of fs.readdirSync(UPLOADS)) {
      const p = path.join(UPLOADS, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* belum ada */ }
}

function initUpload() {
  cleanOld();
  const id = crypto.randomBytes(8).toString('hex');
  fs.mkdirSync(upDir(id), { recursive: true });
  return { id, chunkSize: 3 * 1024 * 1024, maxZip: MAX_ZIP };
}

function saveChunk(id, idx, buf) {
  const dir = upDir(id);
  if (!fs.existsSync(dir)) throw new HttpError(404, 'Upload tidak ditemukan');
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_CHUNKS) throw new HttpError(400, 'Nomor potongan tidak valid');
  if (!buf.length || buf.length > MAX_CHUNK) throw new HttpError(413, 'Ukuran potongan tidak valid');
  const total = fs.readdirSync(dir).filter(f => f.endsWith('.part')).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
  if (total + buf.length > MAX_ZIP) throw new HttpError(413, `Zip melebihi batas ${MAX_ZIP / 1024 / 1024} MB`);
  fs.writeFileSync(path.join(dir, `${String(idx).padStart(4, '0')}.part`), buf);
  return { ok: true, received: idx };
}

function assemble(id, expected) {
  const dir = upDir(id);
  const parts = fs.readdirSync(dir).filter(f => f.endsWith('.part')).sort();
  if (!parts.length || parts.length !== Number(expected)) throw new HttpError(400, `Potongan tidak lengkap (${parts.length}/${expected})`);
  const zip = path.join(dir, 'upload.zip');
  fs.writeFileSync(zip, Buffer.concat(parts.map(f => fs.readFileSync(path.join(dir, f)))));
  const head = Buffer.alloc(4);
  const fd = fs.openSync(zip, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (head.toString('latin1', 0, 2) !== 'PK') throw new HttpError(400, 'File bukan zip yang valid');
  return zip;
}

// Periksa isi zip sebelum diekstrak: batas ukuran/jumlah file dan path berbahaya
const INSPECT_PY = `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
n = 0; size = 0
for i in z.infolist():
    name = i.filename
    if name.startswith('/') or '..' in name.split('/') or '\\\\' in name:
        print('BAD:' + name); sys.exit(2)
    n += 1; size += i.file_size
print(n, size)
`;

async function inspectZip(zip, job) {
  let out;
  try {
    out = (await run('python3', ['-c', INSPECT_PY, zip], { job: null })).trim();
  } catch {
    throw new Error('Zip ditolak: berisi path berbahaya (../ atau absolut) atau file rusak');
  }
  const [n, size] = out.split(' ').map(Number);
  if (!n || Number.isNaN(size)) throw new Error('Isi zip tidak valid');
  if (n > MAX_FILES) throw new Error(`Terlalu banyak file (${n}). Pastikan node_modules dan folder build tidak ikut.`);
  if (size > MAX_UNZIPPED) throw new Error(`Ukuran ekstrak ${(size / 1024 / 1024).toFixed(0)} MB melebihi batas ${MAX_UNZIPPED / 1024 / 1024} MB`);
  append(job, `Zip valid: ${n} file, ${(size / 1024 / 1024).toFixed(1)} MB setelah diekstrak\n`);
}

function detectFramework(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return deps.next ? 'nextjs' : 'node';
  } catch { /* tidak ada package.json */ }
  if (fs.existsSync(path.join(dir, 'index.html'))) return 'static';
  throw new Error('Framework tidak terdeteksi: tidak ada package.json atau index.html di root folder');
}

const GITIGNORE_MUST = ['.env', '.env.*', 'node_modules/', '.next/', '*.log'];

function ensureGitignore(dir) {
  const f = path.join(dir, '.gitignore');
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const have = new Set(cur.split('\n').map(l => l.trim()));
  const add = GITIGNORE_MUST.filter(l => !have.has(l));
  if (add.length) fs.writeFileSync(f, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# ditambahkan Elnicko Space\n${add.join('\n')}\n`);
}

async function pushToGitHub(dir, { name, isPrivate }, job) {
  const st = await githubStatus();
  if (!st.configured) throw new Error('Token GitHub belum terpasang di VPS (lihat petunjuk di dashboard)');
  const env = authEnv(cleanEnv());
  const git = (...a) => run('git', ['-C', dir, ...a], { job, env });

  ensureGitignore(dir);
  const hasGit = fs.existsSync(path.join(dir, '.git'));
  if (!hasGit) await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', st.login);
  await git('config', 'user.email', `${st.login}@users.noreply.github.com`);
  await git('add', '-A');

  // Pengaman: jangan pernah commit file rahasia
  const tracked = (await run('git', ['-C', dir, 'ls-files'], { env })).split('\n').filter(Boolean);
  const secret = tracked.filter(f => /(^|\/)\.env($|\.)/.test(f) && !/\.example$|\.sample$/.test(f));
  if (secret.length) throw new Error(`File rahasia akan ter-commit (${secret.join(', ')}). Dibatalkan.`);

  const staged = (await run('git', ['-C', dir, 'status', '--porcelain'], { env })).trim();
  if (staged) await git('commit', '-q', '-m', hasGit ? 'Update dari Elnicko Space' : 'Initial commit dari Elnicko Space');

  let remote = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { env, allowFail: true })).trim();
  let htmlUrl;
  if (!remote || /^fatal|error:/i.test(remote)) {
    const repo = await createRepo(name, isPrivate);
    append(job, `Repo GitHub dibuat: ${repo.htmlUrl} (${isPrivate ? 'private' : 'publik'})\n`);
    await git('remote', 'add', 'origin', repo.cloneUrl);
    remote = repo.cloneUrl;
    htmlUrl = repo.htmlUrl;
  } else {
    htmlUrl = remote.replace(/\.git$/, '');
  }
  await git('push', '-u', 'origin', 'main');
  append(job, `✅ Ter-push ke GitHub: ${htmlUrl}\n`);
  return { repo: remote.replace(/\.git$/, ''), htmlUrl };
}

function finishUpload(id, input) {
  const deploy = input.deploy !== false;
  const gh = input.github && input.github.push;
  if (!deploy && !gh) throw new HttpError(400, 'Pilih minimal satu: deploy ke VPS atau push ke GitHub');
  const update = !!input.update;

  let domain = null;
  let framework = null;
  if (deploy) {
    domain = normDomain(input.domain);
    framework = String(input.framework || 'auto');
    if (framework !== 'auto' && !FRAMEWORKS.has(framework)) throw new HttpError(400, 'Framework tidak valid');
    const reg = load();
    if (update) {
      if (!reg[domain] || reg[domain].external) throw new HttpError(404, 'Website yang mau diperbarui tidak ditemukan');
    } else if (reg[domain] || fs.existsSync(dirOf(domain))) {
      throw new HttpError(409, 'Domain sudah terdaftar');
    }
  }
  const ghName = gh ? String(input.github.name || '').trim() : '';
  if (gh) {
    if (!REPO_NAME_RE.test(ghName)) throw new HttpError(400, 'Nama repo GitHub tidak valid');
    if (!githubToken()) throw new HttpError(400, 'Token GitHub belum terpasang di VPS');
  }
  const zip = assemble(id, input.chunks);
  const isPrivate = !input.github || input.github.private !== false;
  const base = upDir(id);

  return startJob(deploy ? domain : `upload:${id}`, deploy ? `${update ? 'Upload ulang' : 'Upload'} ${domain}` : `Push ${ghName} ke GitHub`, async (job) => {
    const target = deploy ? dirOf(domain) : path.join(base, 'src');
    const createdDir = !fs.existsSync(target);
    let registered = false;
    try {
      await inspectZip(zip, job);
      fs.mkdirSync(target, { recursive: true });
      await run('python3', ['-m', 'zipfile', '-e', zip, target], { job });
      fs.rmSync(zip, { force: true });

      if (deploy && framework === 'auto') framework = detectFramework(target);
      if (deploy) append(job, `Framework: ${framework}\n`);

      let repoInfo = null;
      if (gh) repoInfo = await pushToGitHub(target, { name: ghName, isPrivate }, job);

      if (deploy) {
        const reg = load();
        let site = reg[domain];
        if (!update) {
          const port = framework === 'static' ? null : await pickPort(reg, input.port);
          site = { domain, repo: repoInfo ? repoInfo.repo : '', branch: 'main', framework, port, source: 'upload', state: 'creating', createdAt: Date.now(), lastDeploy: null };
          reg[domain] = site;
        } else if (repoInfo && !site.repo) {
          site.repo = repoInfo.repo; site.branch = 'main';
        }
        save(reg);
        registered = !update;

        await build(site, job);
        if (site.framework !== 'static') {
          const name = pm2Name(domain);
          if (update && (await pm2Status())[name]) await run('pm2', ['restart', name, '--update-env'], { job, env: cleanEnv({ PORT: String(site.port), NODE_ENV: 'production' }) });
          else await startApp(site, job);
        }
        if (!update) await writeNginx(site, job);
        const r = load();
        if (r[domain]) { r[domain].state = 'ready'; r[domain].lastDeploy = Date.now(); save(r); }
        append(job, `\n✅ ${domain} ${update ? 'diperbarui' : 'aktif'}.${update ? '' : ' Arahkan DNS A record ke server ini, lalu klik SSL.'}\n`);
      }
    } catch (e) {
      if (deploy && !update) {
        const r = load();
        if (registered && r[domain]) { r[domain].state = 'failed'; save(r); }
        else if (createdDir) fs.rmSync(target, { recursive: true, force: true });
      }
      throw e;
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
}

module.exports = { initUpload, saveChunk, finishUpload, githubStatus };

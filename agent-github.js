// Integrasi GitHub di sisi agent. Token dibaca dari file env di VPS (tidak pernah dikirim ke browser atau ditulis ke log).
const fs = require('fs');

const ENV_FILE = process.env.AGENT_ENV_FILE || '/root/.elnicko-agent.env';
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  } catch { /* file tidak ada */ }
  return '';
}

// Dipasang lewat env (GIT_CONFIG_*) supaya token tidak muncul di argumen proses maupun log job
function authEnv(base = {}) {
  const token = githubToken();
  if (!token) return base;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...base,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

async function gh(path, opts = {}) {
  const token = githubToken();
  if (!token) throw new Error('Token GitHub belum dipasang di VPS');
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'elnicko-space-agent',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let cache = { at: 0, value: null };
async function githubStatus() {
  if (!githubToken()) return { configured: false };
  if (cache.value && Date.now() - cache.at < 60000) return cache.value;
  try {
    const { status, data } = await gh('/user');
    cache = { at: Date.now(), value: status === 200 ? { configured: true, login: data.login } : { configured: false, error: `Token ditolak GitHub (${status})` } };
  } catch (e) {
    cache = { at: Date.now(), value: { configured: false, error: e.message } };
  }
  return cache.value;
}

async function createRepo(name, isPrivate) {
  if (!REPO_NAME_RE.test(name) || name === '.' || name === '..') throw new Error('Nama repo tidak valid');
  const { status, data } = await gh('/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, private: !!isPrivate, auto_init: false }),
  });
  if (status === 201) return { cloneUrl: data.clone_url, htmlUrl: data.html_url, owner: data.owner.login };
  if (status === 422) throw new Error(`Repo "${name}" sudah ada di akun GitHub-mu. Pakai nama lain agar tidak menimpa.`);
  if (status === 401 || status === 403) throw new Error('Token GitHub tidak punya izin membuat repo (butuh scope "repo")');
  throw new Error(`GitHub menolak pembuatan repo (${status}): ${String(data.message || '').slice(0, 160)}`);
}

module.exports = { githubToken, authEnv, githubStatus, createRepo, REPO_NAME_RE };

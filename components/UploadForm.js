import { useEffect, useRef, useState } from 'react';
import { call } from './LiveVps';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.vercel', '.turbo', '.cache', '__pycache__', '.venv', 'venv']);
const SKIP_FILES = /(^|\/)(\.DS_Store|Thumbs\.db)$|\.log$/i;
const ENV_FILE = /(^|\/)\.env($|\.)/;
const ENV_SAFE = /\.(example|sample)$/;
const MAX_ZIP = 150 * 1024 * 1024;

const mbStr = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'my-app';

const inputCls = 'w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[14px] outline-none focus:border-violet-500/50';

export default function UploadForm({ updateSite, onJob, onClose, notify }) {
  const [files, setFiles] = useState([]);       // [{ file, rel }]
  const [folder, setFolder] = useState('');
  const [skipped, setSkipped] = useState({ dirs: 0, logs: 0, env: 0 });
  const [hint, setHint] = useState('');
  const [domain, setDomain] = useState(updateSite?.domain || '');
  const [framework, setFramework] = useState('auto');
  const [port, setPort] = useState('');
  const [deploy, setDeploy] = useState(true);
  const [push, setPush] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [includeEnv, setIncludeEnv] = useState(false);
  const [gh, setGh] = useState(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const all = useRef([]);

  useEffect(() => { call('github').then(setGh).catch(() => setGh({ configured: false })); }, []);
  useEffect(() => { if (inputRef.current) inputRef.current.setAttribute('webkitdirectory', ''); }, []);

  const filter = (list, withEnv) => {
    const out = [];
    const sk = { dirs: 0, logs: 0, env: 0 };
    for (const f of list) {
      const parts = (f.webkitRelativePath || f.name).split('/');
      const rel = parts.slice(1).join('/');
      if (!rel) continue;
      if (parts.slice(1, -1).some(p => SKIP_DIRS.has(p))) { sk.dirs++; continue; }
      if (SKIP_FILES.test(rel)) { sk.logs++; continue; }
      if (ENV_FILE.test(rel) && !ENV_SAFE.test(rel) && !withEnv) { sk.env++; continue; }
      out.push({ file: f, rel });
    }
    return { out, sk };
  };

  const pick = async (e) => {
    const list = Array.from(e.target.files || []);
    all.current = list;
    if (!list.length) return;
    const name = (list[0].webkitRelativePath || '').split('/')[0] || 'folder';
    setFolder(name);
    if (!repoName) setRepoName(slug(name));
    apply(list, includeEnv);
  };

  const apply = async (list, withEnv) => {
    const { out, sk } = filter(list, withEnv);
    setFiles(out); setSkipped(sk);
    const pkg = out.find(x => x.rel === 'package.json');
    if (pkg) {
      try {
        const j = JSON.parse(await pkg.file.text());
        const deps = { ...j.dependencies, ...j.devDependencies };
        setHint(deps.next ? 'Next.js' : 'Node.js');
      } catch { setHint('Node.js'); }
    } else if (out.some(x => x.rel === 'index.html')) setHint('Static (HTML)');
    else setHint('');
  };

  useEffect(() => { if (all.current.length) apply(all.current, includeEnv); /* eslint-disable-next-line */ }, [includeEnv]);

  const total = files.reduce((a, x) => a + x.file.size, 0);
  const ghReady = gh?.configured;
  const canSubmit = files.length > 0 && !busy && (deploy || push) && (!deploy || domain.trim()) && (!push || (ghReady && repoName.trim()));

  const submit = async () => {
    setErr(''); setProgress(0);
    try {
      setBusy('Membuat zip...');
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const { file, rel } of files) zip.file(rel, file);
      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (m) => setProgress(Math.round(m.percent * 0.3)),
      );
      if (blob.size > MAX_ZIP) throw new Error(`Zip ${mbStr(blob.size)} melebihi batas ${mbStr(MAX_ZIP)}. Pastikan node_modules dan folder build tidak ikut.`);

      setBusy('Mengunggah...');
      const init = await call('uploads', 'POST', {});
      if (init.mock) throw new Error('VPS_API_URL belum diset (mode mock)');
      const size = init.chunkSize;
      const n = Math.ceil(blob.size / size);
      for (let i = 0; i < n; i++) {
        const r = await fetch(`/api/vps/upload?id=${init.id}&idx=${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob.slice(i * size, (i + 1) * size) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Unggah potongan ${i + 1} gagal`);
        setProgress(30 + Math.round(((i + 1) / n) * 70));
      }

      setBusy('Memproses di VPS...');
      const fin = await call(`uploads/${init.id}/finish`, 'POST', {
        chunks: n,
        deploy,
        update: !!updateSite,
        domain: domain.trim().toLowerCase(),
        framework,
        port: port ? Number(port) : undefined,
        github: push ? { push: true, name: repoName.trim(), private: isPrivate } : undefined,
      });
      onJob(fin.job);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy('');
    }
  };

  return (
    <div>
      <div className="space-y-4">
        <div>
          <label className="mono text-[11px] text-white/50">Folder proyek</label>
          <input ref={inputRef} type="file" multiple onChange={pick} className="w-full mt-1 text-[12px] text-white/70 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-[12px] file:font-bold file:text-black" />
          {files.length > 0 && (
            <p className="mono text-[11px] text-white/50 mt-2">
              {folder}: {files.length} file, {mbStr(total)} {hint && <>• terdeteksi <span className="text-white/80">{hint}</span></>}
              <br />dilewati: {skipped.dirs} file di node_modules/.git/.next dll, {skipped.logs} log{skipped.env ? `, ${skipped.env} file .env (rahasia)` : ''}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" checked={deploy} onChange={e => setDeploy(e.target.checked)} /> Deploy ke VPS</label>
          <label className={`flex items-center gap-2 text-[13px] ${ghReady ? 'cursor-pointer' : 'opacity-50'}`}><input type="checkbox" disabled={!ghReady} checked={push} onChange={e => setPush(e.target.checked)} /> Push ke GitHub</label>
        </div>

        {deploy && (
          <>
            <div><label className="mono text-[11px] text-white/50">Domain</label><input value={domain} onChange={e => setDomain(e.target.value)} disabled={!!updateSite} placeholder="baru.com" className={inputCls + ' disabled:opacity-60'} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mono text-[11px] text-white/50">Framework</label>
                <select value={framework} onChange={e => setFramework(e.target.value)} className={inputCls}>
                  <option value="auto">Otomatis{hint ? ` (${hint})` : ''}</option><option value="nextjs">Next.js</option><option value="node">Node.js (npm start)</option><option value="static">Static (HTML)</option>
                </select></div>
              <div><label className="mono text-[11px] text-white/50">Port (opsional)</label><input type="number" value={port} onChange={e => setPort(e.target.value)} disabled={!!updateSite} placeholder="otomatis" className={inputCls + ' disabled:opacity-40'} /></div>
            </div>
          </>
        )}

        {push && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mono text-[11px] text-white/50">Nama repo GitHub</label><input value={repoName} onChange={e => setRepoName(e.target.value)} className={inputCls} /></div>
            <label className="flex items-end gap-2 text-[13px] pb-3 cursor-pointer"><input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} /> Private</label>
          </div>
        )}

        {gh && !ghReady && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-[12px] text-amber-200">
            <b>Push ke GitHub belum aktif.</b>{gh.error ? ` (${gh.error})` : ''} Buat token klasik di GitHub → Settings → Developer settings → Personal access tokens (classic), centang scope <span className="mono">repo</span>, lalu di terminal VPS jalankan:
            <pre className="mono mt-2 text-[11px] whitespace-pre-wrap break-all text-white/80">{"echo 'GITHUB_TOKEN=ghp_tokenmu' >> /root/.elnicko-agent.env"}</pre>
            Tidak perlu restart. Token hanya tersimpan di VPS, tidak pernah dikirim ke browser.
          </div>
        )}
        {gh?.configured && <p className="text-[11px] text-white/40">GitHub terhubung sebagai <span className="mono text-white/70">{gh.login}</span>.</p>}

        <label className="flex items-start gap-2 text-[12px] text-white/60 cursor-pointer">
          <input type="checkbox" checked={includeEnv} onChange={e => setIncludeEnv(e.target.checked)} className="mt-1" />
          <span>Sertakan file <span className="mono">.env</span> ke VPS (untuk dipakai aplikasi). Tidak pernah ikut ke GitHub.</span>
        </label>
      </div>

      {err && <p className="text-[12px] text-red-400 mt-4">{err}</p>}
      {busy && (
        <div className="mt-4">
          <p className="text-[12px] text-white/60">{busy} {progress}%</p>
          <div className="h-1 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div>
        </div>
      )}
      <div className="flex gap-3 mt-6">
        <button onClick={onClose} disabled={!!busy} className="flex-1 py-3 rounded-full bg-white/10 text-[13px] disabled:opacity-50">Batal</button>
        <button onClick={submit} disabled={!canSubmit} className="flex-1 py-3 rounded-full bg-white text-black font-bold text-[13px] disabled:opacity-50">{busy || (updateSite ? 'Upload ulang' : deploy && push ? 'Upload, push & deploy' : push ? 'Push ke GitHub' : 'Upload & deploy')}</button>
      </div>
    </div>
  );
}

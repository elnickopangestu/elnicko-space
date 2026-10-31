import { useEffect, useRef, useState } from 'react';
import { call } from './LiveVps';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.vercel', '.turbo', '.cache', '__pycache__', '.venv', 'venv']);
const SKIP_FILES = /(^|\/)(\.DS_Store|Thumbs\.db)$|\.log$/i;
const ENV_FILE = /(^|\/)\.env($|\.)/;
const ENV_SAFE = /\.(example|sample)$/;
const MAX_ZIP = 150 * 1024 * 1024;

const mbStr = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'my-app';

// 'ok' | 'dirs' | 'logs' | 'env'
function classify(rel, withEnv) {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some(p => SKIP_DIRS.has(p))) return 'dirs';
  if (SKIP_FILES.test(rel)) return 'logs';
  if (ENV_FILE.test(rel) && !ENV_SAFE.test(rel) && !withEnv) return 'env';
  return 'ok';
}

const inputCls = 'w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[16px] sm:text-[14px] outline-none focus:border-violet-500/50';
const fileCls = 'w-full mt-1 text-[13px] text-white/70 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2.5 file:text-[13px] file:font-bold file:text-black';

export default function UploadForm({ updateSite, onJob, onClose }) {
  const [files, setFiles] = useState([]);       // [{ file: File|Blob, rel }]
  const [source, setSource] = useState('');     // nama folder / zip
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
  const dirInput = useRef(null);
  const src = useRef(null); // { kind: 'dir', list } | { kind: 'zip', items: [{ rel, entry }] }
  const blobCache = useRef(new Map());

  useEffect(() => { call('github').then(setGh).catch(() => setGh({ configured: false })); }, []);
  useEffect(() => { if (dirInput.current) dirInput.current.setAttribute('webkitdirectory', ''); }, []);

  const detect = async (out) => {
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

  const apply = async (withEnv) => {
    const s = src.current;
    if (!s) return;
    const sk = { dirs: 0, logs: 0, env: 0 };
    const out = [];
    const items = s.kind === 'dir' ? s.items : s.items;
    for (const it of items) {
      const c = classify(it.rel, withEnv);
      if (c !== 'ok') { sk[c]++; continue; }
      if (it.file) { out.push({ file: it.file, rel: it.rel }); continue; }
      let blob = blobCache.current.get(it.rel);
      if (!blob) { blob = await it.entry.async('blob'); blobCache.current.set(it.rel, blob); }
      out.push({ file: blob, rel: it.rel });
    }
    setFiles(out); setSkipped(sk);
    await detect(out);
  };

  useEffect(() => { if (src.current) apply(includeEnv); /* eslint-disable-next-line */ }, [includeEnv]);

  const pickDir = async (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setErr('');
    const name = (list[0].webkitRelativePath || '').split('/')[0] || 'folder';
    src.current = { kind: 'dir', items: list.map(f => ({ rel: (f.webkitRelativePath || f.name).split('/').slice(1).join('/'), file: f })).filter(x => x.rel) };
    setSource(name);
    if (!repoName) setRepoName(slug(name));
    await apply(includeEnv);
  };

  const pickZip = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(''); setBusy('Membaca zip...');
    try {
      const JSZip = (await import('jszip')).default;
      const z = await JSZip.loadAsync(f);
      const entries = Object.values(z.files).filter(x => !x.dir && !x.name.startsWith('__MACOSX/'));
      if (!entries.length) throw new Error('Zip kosong');
      // Zip dari "Compress folder" biasanya punya satu folder induk: buang
      const roots = new Set(entries.map(x => x.name.split('/')[0]));
      const strip = roots.size === 1 && entries.every(x => x.name.includes('/'));
      blobCache.current = new Map();
      src.current = { kind: 'zip', items: entries.map(x => ({ rel: strip ? x.name.split('/').slice(1).join('/') : x.name, entry: x })) };
      const name = f.name.replace(/\.zip$/i, '');
      setSource(name);
      if (!repoName) setRepoName(slug(name));
      await apply(includeEnv);
    } catch (e2) { setErr(`Zip tidak bisa dibaca: ${e2.message}`); }
    setBusy('');
  };

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
          <label className="mono text-[11px] text-white/50">File ZIP proyek (disarankan di HP)</label>
          <input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={pickZip} className={fileCls} />
        </div>
        <div className="hidden sm:block">
          <label className="mono text-[11px] text-white/50">atau pilih folder (komputer)</label>
          <input ref={dirInput} type="file" multiple onChange={pickDir} className={fileCls} />
        </div>
        {files.length > 0 && (
          <p className="mono text-[11px] text-white/50">
            {source}: {files.length} file, {mbStr(total)} {hint && <>• terdeteksi <span className="text-white/80">{hint}</span></>}
            <br />dilewati: {skipped.dirs} file di node_modules/.git/.next dll, {skipped.logs} log{skipped.env ? `, ${skipped.env} file .env (rahasia)` : ''}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-[14px] min-h-[40px] cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={deploy} onChange={e => setDeploy(e.target.checked)} /> Deploy ke VPS</label>
          <label className={`flex items-center gap-2 text-[14px] min-h-[40px] ${ghReady ? 'cursor-pointer' : 'opacity-50'}`}><input type="checkbox" className="w-4 h-4" disabled={!ghReady} checked={push} onChange={e => setPush(e.target.checked)} /> Push ke GitHub</label>
        </div>

        {deploy && (
          <>
            <div><label className="mono text-[11px] text-white/50">Domain</label><input value={domain} onChange={e => setDomain(e.target.value)} disabled={!!updateSite} placeholder="baru.com" inputMode="url" autoCapitalize="none" className={inputCls + ' disabled:opacity-60'} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mono text-[11px] text-white/50">Framework</label>
                <select value={framework} onChange={e => setFramework(e.target.value)} className={inputCls}>
                  <option value="auto">Otomatis{hint ? ` (${hint})` : ''}</option><option value="nextjs">Next.js</option><option value="node">Node.js (npm start)</option><option value="static">Static (HTML)</option>
                </select></div>
              <div><label className="mono text-[11px] text-white/50">Port (opsional)</label><input type="number" inputMode="numeric" value={port} onChange={e => setPort(e.target.value)} disabled={!!updateSite} placeholder="otomatis" className={inputCls + ' disabled:opacity-40'} /></div>
            </div>
          </>
        )}

        {push && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mono text-[11px] text-white/50">Nama repo GitHub</label><input value={repoName} onChange={e => setRepoName(e.target.value)} autoCapitalize="none" className={inputCls} /></div>
            <label className="flex items-end gap-2 text-[14px] pb-3 cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} /> Private</label>
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
          <input type="checkbox" className="mt-1 w-4 h-4" checked={includeEnv} onChange={e => setIncludeEnv(e.target.checked)} />
          <span>Sertakan file <span className="mono">.env</span> ke VPS (untuk dipakai aplikasi). Tidak pernah ikut ke GitHub.</span>
        </label>
      </div>

      {err && <p className="text-[12px] text-red-400 mt-4">{err}</p>}
      {busy && (
        <div className="mt-4">
          <p className="text-[12px] text-white/60">{busy} {progress > 0 ? `${progress}%` : ''}</p>
          <div className="h-1 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div>
        </div>
      )}
      <div className="flex gap-3 mt-6">
        <button onClick={onClose} disabled={!!busy} className="flex-1 min-h-[44px] rounded-full bg-white/10 text-[13px] disabled:opacity-50">Batal</button>
        <button onClick={submit} disabled={!canSubmit} className="flex-[2] min-h-[44px] rounded-full bg-white text-black font-bold text-[13px] disabled:opacity-50">{busy || (updateSite ? 'Upload ulang' : deploy && push ? 'Upload, push & deploy' : push ? 'Push ke GitHub' : 'Upload & deploy')}</button>
      </div>
    </div>
  );
}

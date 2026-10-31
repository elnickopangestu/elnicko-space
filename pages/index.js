import { useState, useEffect, useRef } from 'react';
import { useVps, useSites, VpsApps, gb, call } from '../components/LiveVps';

const FRAMEWORKS = [
  { value: 'nextjs', label: 'Next.js' },
  { value: 'node', label: 'Node.js (npm start)' },
  { value: 'static', label: 'Static (HTML)' },
];

const ago = (t) => {
  if (!t) return '-';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'Baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} jam lalu` : `${Math.floor(h / 24)} hari lalu`;
};

export default function ElnickoSpace() {
  const vps = useVps();
  const siteList = useSites();
  const [logs, setLogs] = useState(['[System] Elnicko Space siap']);
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newSite, setNewSite] = useState({ domain: '', repo: '', branch: 'main', framework: 'nextjs', port: '' });
  const [mode, setMode] = useState('github');
  const [imp, setImp] = useState({ domain: '', pm2: '', port: '' });
  const logRef = useRef(null);

  const addLog = (msg) => setLogs(prev => [...prev.slice(-300), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  // Ikuti job yang sedang berjalan dan tampilkan lognya
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    let shown = 0;
    const tick = async () => {
      try {
        const j = await call(`jobs/${jobId}`);
        const lines = j.log.split('\n');
        if (lines.length > shown) {
          const fresh = lines.slice(shown).filter(Boolean);
          if (fresh.length) setLogs(p => [...p.slice(-300), ...fresh]);
          shown = lines.length;
        }
        if (j.status !== 'running') {
          setBusy(null); setJobId(null); siteList.refresh();
          notify(j.status === 'done' ? `✅ ${j.title} selesai` : `❌ ${j.title} gagal`);
          return;
        }
      } catch (e) { addLog(`❌ ${e.message}`); setBusy(null); setJobId(null); return; }
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const startJobCall = async (domain, path, label) => {
    setBusy(domain);
    addLog(`> ${label} ${domain}`);
    try {
      const d = await call(path, 'POST');
      if (d.mock) { addLog('MOCK: VPS_API_URL belum diset'); setBusy(null); return; }
      setJobId(d.job);
    } catch (e) { addLog(`❌ ${e.message}`); setBusy(null); }
  };

  const handleDeploy = (s) => startJobCall(s.domain, `sites/${s.domain}/deploy`, 'deploy');
  const handleSsl = (s) => startJobCall(s.domain, `sites/${s.domain}/ssl`, 'ssl');
  const handleDelete = (s) => {
    const msg = s.external
      ? `LEPAS ${s.domain} dari dashboard? Konfigurasi nginx dan sertifikat domain dihapus, tapi aplikasi "${s.pm2}" tetap berjalan.`
      : `HAPUS ${s.domain}? File website, konfigurasi nginx, dan sertifikat akan dihapus dari VPS.`;
    if (!confirm(msg)) return;
    startJobCall(s.domain, `sites/${s.domain}/delete`, s.external ? 'lepas' : 'hapus');
  };

  const handleImport = async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/vps/proxy?path=sites/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...imp, port: Number(imp.port) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { notify(`❌ ${d.error || 'Gagal'}`); setCreating(false); return; }
      if (d.mock) { notify('MOCK: VPS_API_URL belum diset'); setCreating(false); return; }
      setShowModal(false);
      setBusy(imp.domain.trim().toLowerCase());
      addLog(`> import ${imp.domain}`);
      setImp({ domain: '', pm2: '', port: '' });
      setJobId(d.job);
      siteList.refresh();
    } catch (e) { notify(`❌ ${e.message}`); }
    setCreating(false);
  };

  const handleControl = async (s, action) => {
    setBusy(s.domain);
    try { await call(`sites/${s.domain}/${action}`, 'POST'); addLog(`✅ ${s.domain} ${action} OK`); siteList.refresh(); }
    catch (e) { addLog(`❌ ${s.domain} ${action}: ${e.message}`); }
    setBusy(null);
  };

  const handleLogs = async (s) => {
    try {
      const d = await call(`sites/${s.domain}/logs`);
      addLog(`--- log ${s.domain} ---`);
      const lines = (d.logs || '').split('\n').slice(-60).filter(Boolean);
      setLogs(p => [...p.slice(-300), ...lines]);
      document.getElementById('logs')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { addLog(`❌ ${e.message}`); }
  };

  const handleAddSite = async () => {
    setCreating(true);
    try {
      const body = { ...newSite, port: newSite.port ? Number(newSite.port) : undefined };
      const r = await fetch('/api/vps/proxy?path=sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { notify(`❌ ${d.error || 'Gagal'}`); setCreating(false); return; }
      if (d.mock) { notify('MOCK: VPS_API_URL belum diset'); setCreating(false); return; }
      setShowModal(false);
      setBusy(newSite.domain.trim().toLowerCase());
      addLog(`> membuat ${newSite.domain}`);
      setNewSite({ domain: '', repo: '', branch: 'main', framework: 'nextjs', port: '' });
      setJobId(d.job);
      siteList.refresh();
    } catch (e) { notify(`❌ ${e.message}`); }
    setCreating(false);
  };

  const sites = siteList.sites || [];
  const filtered = sites.filter(s => s.domain.includes(filter.toLowerCase()));
  const running = sites.filter(s => s.framework === 'static' ? s.state === 'ready' : s.process?.status === 'online').length;
  const inputCls = 'w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[14px] outline-none focus:border-violet-500/50';

  return (
    <div className="min-h-screen bg-[#06080f] text-white" style={{fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'}}>
      <style jsx global>{`
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; }
        .glass { background: rgba(17, 20, 38, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); }
        .glow { box-shadow: 0 0 30px rgba(124, 58, 237, 0.15); }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }
        .pulse-dot { animation: pulse-dot 2s infinite; }
        .starfield { background-image: radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 40% 70%, #fff, transparent), radial-gradient(1.5px 1.5px at 90% 40%, #a5b4fc, transparent), radial-gradient(1px 1px at 60% 10%, #fff, transparent); }
      `}</style>

      <div className="fixed inset-0 starfield opacity-40 pointer-events-none" />

      <header className="sticky top-0 z-40 border-b border-white/10 glass">
        <div className="max-w-[1600px] mx-auto px-6 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center glow">◐</div>
            <div>
              <h1 className="font-bold tracking-widest text-[14px]">ELNICKO SPACE</h1>
              <p className="mono text-[11px] text-white/50">VPS MANAGER • {vps.status?.hostname || 'VPS'}</p>
            </div>
            <div className="hidden md:flex items-center gap-2 ml-6 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className={`w-2 h-2 rounded-full ${vps.status ? 'bg-emerald-400 pulse-dot' : 'bg-red-400'}`} />
              <span className="mono text-[11px] text-emerald-300">{vps.status ? `ONLINE • ${vps.status.cpus} vCPU • ${gb(vps.status.memory.total)}` : vps.error ? 'OFFLINE' : 'CONNECTING'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Cari domain..." className="hidden md:block bg-white/5 border border-white/10 rounded-full px-4 py-2 text-[13px] w-56 outline-none focus:border-violet-500/50" />
            <button onClick={()=>setShowModal(true)} className="px-4 py-2 rounded-full bg-white text-black text-[13px] font-bold hover:bg-white/90 transition">+ New Website</button>
            <button onClick={async()=>{await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login'}} className="px-4 py-2 rounded-full border border-white/10 text-[13px] text-white/70 hover:bg-white/5 transition">Logout</button>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-12 gap-6 relative">
        <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Websites', value: sites.length, sub: `${running} running` },
            { label: 'CPU Usage', value: vps.status ? `${vps.status.cpuPercent}%` : '—', sub: vps.status ? `${vps.status.cpus} vCPU • load ${vps.status.load[0].toFixed(2)}` : 'menunggu VPS', bar: vps.status?.cpuPercent },
            { label: 'RAM Usage', value: vps.status ? gb(vps.status.memory.used) : '—', sub: vps.status ? `dari ${gb(vps.status.memory.total)}` : 'menunggu VPS', bar: vps.status ? Math.round(vps.status.memory.used / vps.status.memory.total * 100) : undefined },
            { label: 'Disk Usage', value: vps.status ? gb(vps.status.disk.used) : '—', sub: vps.status ? `dari ${gb(vps.status.disk.total)}` : 'menunggu VPS', bar: vps.status ? Math.round(vps.status.disk.used / vps.status.disk.total * 100) : undefined },
          ].map((s,i)=>(
            <div key={i} className="glass rounded-2xl p-4">
              <p className="text-[11px] text-white/40 tracking-widest">{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
              <p className="mono text-[11px] text-white/50 mt-1">{s.sub}</p>
              {s.bar != null && <div className="h-1 bg-white/10 rounded-full mt-3 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{width: `${s.bar}%`}} /></div>}
            </div>
          ))}
        </div>

        <VpsApps apps={vps.apps} error={vps.error} mock={vps.mock} setApps={vps.setApps} onLog={addLog} />

        <div className="col-span-12 lg:col-span-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">Websites • {filtered.length}</h2>
            <span className="mono text-[11px] text-white/40">{siteList.error ? siteList.error : siteList.mock ? 'MOCK • VPS_API_URL belum diset' : 'Domain harus A record ke IP VPS'}</span>
          </div>
          {siteList.sites && filtered.length === 0 && (
            <div className="glass rounded-2xl p-8 text-center text-[13px] text-white/50">
              Belum ada website. Klik <b className="text-white">+ New Website</b> untuk deploy dari repo GitHub.
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map(site => {
              const isStatic = site.framework === 'static';
              const online = isStatic ? site.state === 'ready' : site.process?.status === 'online';
              const working = busy === site.domain || site.state === 'creating';
              return (
                <div key={site.domain} className="glass rounded-2xl p-5 hover:border-violet-500/30 transition group">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${site.state === 'failed' ? 'bg-amber-400' : online ? 'bg-emerald-400 pulse-dot' : 'bg-red-400'}`} />
                        <h3 className="font-bold truncate">{site.domain}</h3>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="mono text-[11px] px-2 py-1 rounded-full bg-white/10">{site.framework}</span>
                        {site.port && <span className="mono text-[11px] px-2 py-1 rounded-full bg-white/5">:{site.port}</span>}
                        {site.ssl && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">SSL ✓</span>}
                        {site.state === 'failed' && <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-300">Gagal dibuat</span>}
                        {site.state === 'creating' && <span className="text-[11px] px-2 py-1 rounded-full bg-violet-500/15 text-violet-300">Membuat...</span>}
                      </div>
                    </div>
                    <span className="mono text-[11px] text-white/40 shrink-0 ml-2">{ago(site.lastDeploy)}</span>
                  </div>
                  <p className="mono text-[11px] text-white/30 mt-3 truncate">{site.external ? `app dari VPS • pm2: ${site.pm2}` : `${site.repo.replace('https://github.com/','')} • ${site.branch}`}</p>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {!site.external && (
                      <button onClick={()=>handleDeploy(site)} disabled={working || site.state === 'failed'} className={`flex-1 py-2 rounded-full text-[12px] font-bold transition ${working ? 'bg-white/10' : 'bg-white text-black hover:bg-white/90'} disabled:opacity-50`}>
                        {working ? 'Bekerja...' : 'Deploy'}
                      </button>
                    )}
                    {!isStatic && <button disabled={working} onClick={()=>handleControl(site, online ? 'stop' : 'start')} className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-[12px] disabled:opacity-50">{online ? 'Stop' : 'Start'}</button>}
                    {!site.ssl && site.state === 'ready' && <button disabled={working} onClick={()=>handleSsl(site)} className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-[12px] disabled:opacity-50">SSL</button>}
                    <button onClick={()=>handleLogs(site)} className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-[12px]">Logs</button>
                    <button disabled={working} onClick={()=>handleDelete(site)} className="px-3 py-2 rounded-full bg-red-500/10 text-red-300 hover:bg-red-500/20 text-[12px] disabled:opacity-50">{site.external ? 'Lepas' : 'Hapus'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="glass rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-bold text-[13px]">Live Logs</h3>
              <span className="mono text-[10px] text-white/40">{jobId ? 'JOB BERJALAN...' : 'IDLE'}</span>
            </div>
            <div id="logs" ref={logRef} className="mono h-[320px] overflow-auto bg-black/50 p-4 text-[11px] leading-5">
              {logs.map((l,i)=><div key={i} className={`whitespace-pre-wrap break-all ${l.includes('✅')?'text-emerald-300': l.includes('❌')?'text-red-300': l.includes('$')||l.includes('>')?'text-white/80':'text-white/40'}`}>{l}</div>)}
            </div>
            <div className="p-3 bg-white/5 flex gap-2">
              <button onClick={()=>setLogs([])} className="text-[11px] px-3 py-1 rounded-full bg-white/10">Clear</button>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="glass rounded-2xl w-full max-w-md p-6 glow max-h-full overflow-auto">
            <h3 className="font-bold text-lg mb-4">Add New Website</h3>
            <div className="flex gap-2 mb-4">
              {[['github', 'Dari GitHub'], ['import', 'Import dari VPS']].map(([k, label]) => (
                <button key={k} onClick={()=>setMode(k)} className={`flex-1 py-2 rounded-full text-[12px] font-bold ${mode === k ? 'bg-white text-black' : 'bg-white/10'}`}>{label}</button>
              ))}
            </div>
            {mode === 'import' ? (
              <>
                <div className="space-y-4">
                  <div><label className="mono text-[11px] text-white/50">Domain</label><input value={imp.domain} onChange={e=>setImp({...imp, domain: e.target.value})} placeholder="bot.namamu.com" className={inputCls} /></div>
                  <div><label className="mono text-[11px] text-white/50">Proses pm2 yang sudah berjalan</label>
                    <select value={imp.pm2} onChange={e=>setImp({...imp, pm2: e.target.value})} className={inputCls}>
                      <option value="">Pilih proses...</option>
                      {(vps.apps || []).filter(a => !a.protected && !a.name.startsWith('site-')).map(a => <option key={a.name} value={a.name}>{a.name} ({a.status})</option>)}
                    </select>
                  </div>
                  <div><label className="mono text-[11px] text-white/50">Port aplikasi</label><input type="number" value={imp.port} onChange={e=>setImp({...imp, port: e.target.value})} placeholder="mis. 3000" className={inputCls} /></div>
                  <p className="text-[11px] text-white/40">Aplikasi tidak diubah atau di-restart. Dashboard hanya membuat konfigurasi nginx untuk domain ini. Arahkan DNS A record ke IP VPS, lalu klik SSL.</p>
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={()=>setShowModal(false)} className="flex-1 py-3 rounded-full bg-white/10 text-[13px]">Batal</button>
                  <button onClick={handleImport} disabled={creating || !imp.domain || !imp.pm2 || !imp.port} className="flex-1 py-3 rounded-full bg-white text-black font-bold text-[13px] disabled:opacity-50">{creating ? 'Memproses...' : 'Import'}</button>
                </div>
              </>
            ) : (
            <>
            <div className="space-y-4">
              <div><label className="mono text-[11px] text-white/50">Domain</label><input value={newSite.domain} onChange={e=>setNewSite({...newSite, domain: e.target.value})} placeholder="baru.com" className={inputCls} /></div>
              <div><label className="mono text-[11px] text-white/50">GitHub Repo (publik)</label><input value={newSite.repo} onChange={e=>setNewSite({...newSite, repo: e.target.value})} placeholder="https://github.com/user/repo" className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mono text-[11px] text-white/50">Branch</label><input value={newSite.branch} onChange={e=>setNewSite({...newSite, branch: e.target.value})} className={inputCls} /></div>
                <div><label className="mono text-[11px] text-white/50">Port (opsional)</label><input type="number" value={newSite.port} onChange={e=>setNewSite({...newSite, port: e.target.value})} placeholder="otomatis" disabled={newSite.framework === 'static'} className={inputCls + ' disabled:opacity-40'} /></div>
              </div>
              <div><label className="mono text-[11px] text-white/50">Framework</label><select value={newSite.framework} onChange={e=>setNewSite({...newSite, framework: e.target.value})} className={inputCls}>{FRAMEWORKS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
              <p className="text-[11px] text-white/40">Build berjalan di VPS. Setelah selesai, arahkan DNS A record domain ke IP VPS, lalu klik SSL.</p>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setShowModal(false)} className="flex-1 py-3 rounded-full bg-white/10 text-[13px]">Batal</button>
              <button onClick={handleAddSite} disabled={creating || !newSite.domain || !newSite.repo} className="flex-1 py-3 rounded-full bg-white text-black font-bold text-[13px] disabled:opacity-50">{creating ? 'Membuat...' : 'Buat Website'}</button>
            </div>
            </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 right-6 glass rounded-full px-5 py-3 text-[13px] font-bold glow">{toast}</div>}
    </div>
  );
}

import { useState } from 'react';
import { useVps, VpsApps, gb } from '../components/LiveVps';

const initialSites = [
  { id: 1, domain: 'tokoku.id', framework: 'Next.js', port: 3000, status: 'running', ssl: true, lastDeploy: '2 jam lalu', vercel: true, cpu: 12 },
  { id: 2, domain: 'portofolio.elnicko.id', framework: 'Static', port: 3001, status: 'running', ssl: true, lastDeploy: '1 hari lalu', vercel: false, cpu: 2 },
  { id: 3, domain: 'api.tokoku.id', framework: 'Node API', port: 3002, status: 'running', ssl: true, lastDeploy: '5 jam lalu', vercel: false, cpu: 18 },
  { id: 4, domain: 'client-laundry.com', framework: 'Laravel', port: 3003, status: 'stopped', ssl: false, lastDeploy: '3 hari lalu', vercel: false, cpu: 0 },
  { id: 5, domain: 'blog.elnicko.id', framework: 'WordPress', port: 3004, status: 'running', ssl: true, lastDeploy: '12 jam lalu', vercel: false, cpu: 8 },
];

export default function ElnickoSpace() {
  const [sites, setSites] = useState(initialSites);
  const vps = useVps();
  const [logs, setLogs] = useState(['[System] Elnicko Space Agent connected...', '[System] VPS Bandung - Online', '[System] Ready for deploy commands']);
  const [showModal, setShowModal] = useState(false);
  const [deployingId, setDeployingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('');
  const [newSite, setNewSite] = useState({ domain: '', repo: '', framework: 'Next.js', port: 3005 });

  const addLog = (msg) => setLogs(prev => [...prev.slice(-80), `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleDeploy = async (site) => {
    setDeployingId(site.id);
    addLog(`> Deploying ${site.domain}...`);
    addLog(`> git pull origin main`);
    await new Promise(r => setTimeout(r, 800));
    addLog(`> Already up to date / pulling changes`);
    addLog(`> ${site.framework === 'Next.js' ? 'npm run build' : site.framework === 'Laravel' ? 'composer install' : 'building...'}`);
    await new Promise(r => setTimeout(r, 1200));
    addLog(`> docker build -t ${site.domain} .`);
    await new Promise(r => setTimeout(r, 1000));
    addLog(`> Restarting container :${site.port} ...`);
    await new Promise(r => setTimeout(r, 600));
    addLog(`✅ ${site.domain} deployed successfully - LIVE`);
    setSites(s => s.map(x => x.id === site.id ? { ...x, lastDeploy: 'Baru saja', status: 'running' } : x));
    setDeployingId(null);
    setToast(`🚀 ${site.domain} berhasil deploy!`);
    setTimeout(() => setToast(null), 3000);
  };

  const handleRestart = (site) => {
    setSites(s => s.map(x => x.id === site.id ? { ...x, status: x.status === 'running' ? 'stopped' : 'running' } : x));
    addLog(`${site.status === 'running' ? 'Stopping' : 'Starting'} ${site.domain} ... Done`);
  };

  const handleAddSite = () => {
    if (!newSite.domain.includes('.')) {
      setToast('❌ Domain harus valid (contoh: baru.com)');
      setTimeout(() => setToast(null), 2500);
      return;
    }
    if (sites.some(s => s.port === Number(newSite.port))) {
      setToast('❌ Port sudah dipakai');
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const site = { id: Date.now(), domain: newSite.domain, framework: newSite.framework, port: Number(newSite.port), status: 'running', ssl: true, lastDeploy: 'Baru saja', vercel: false, cpu: 5 };
    setSites([...sites, site]);
    addLog(`✅ New site added: ${site.domain} on :${site.port}`);
    setShowModal(false);
    setNewSite({ domain: '', repo: '', framework: 'Next.js', port: 3006 });
    setToast(`✨ ${site.domain} ditambahkan`);
    setTimeout(() => setToast(null), 3000);
  };

  const filtered = sites.filter(s => s.domain.toLowerCase().includes(filter.toLowerCase()));

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
              <p className="mono text-[11px] text-white/50">VPS MANAGER • BANDUNG • v1.0</p>
            </div>
            <div className="hidden md:flex items-center gap-2 ml-6 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
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
            { label: 'Total Websites', value: sites.length, sub: `${sites.filter(s=>s.status==='running').length} running` },
            { label: 'CPU Usage', value: vps.status ? `${vps.status.cpuPercent}%` : '—', sub: vps.status ? `${vps.status.cpus} vCPU • load ${vps.status.load[0].toFixed(2)}` : 'menunggu VPS', bar: vps.status?.cpuPercent },
            { label: 'RAM Usage', value: vps.status ? gb(vps.status.memory.used) : '—', sub: vps.status ? `dari ${gb(vps.status.memory.total)}` : 'menunggu VPS', bar: vps.status ? Math.round(vps.status.memory.used / vps.status.memory.total * 100) : undefined },
            { label: 'Disk Usage', value: vps.status ? gb(vps.status.disk.used) : '—', sub: vps.status ? `dari ${gb(vps.status.disk.total)}` : 'menunggu VPS', bar: vps.status ? Math.round(vps.status.disk.used / vps.status.disk.total * 100) : undefined },
          ].map((s,i)=>(
            <div key={i} className="glass rounded-2xl p-4">
              <p className="text-[11px] text-white/40 tracking-widest">{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
              <p className="mono text-[11px] text-white/50 mt-1">{s.sub}</p>
              {s.bar && <div className="h-1 bg-white/10 rounded-full mt-3 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{width: `${s.bar}%`}} /></div>}
            </div>
          ))}
        </div>

        <VpsApps apps={vps.apps} error={vps.error} mock={vps.mock} setApps={vps.setApps} onLog={addLog} />

        <div className="col-span-12 lg:col-span-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">Websites • {filtered.length}</h2>
            <span className="mono text-[11px] text-white/40">1 VPS • Semua domain point ke IP yang sama</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map(site=>(
              <div key={site.id} className="glass rounded-2xl p-5 hover:border-violet-500/30 transition group">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${site.status==='running'?'bg-emerald-400 pulse-dot':'bg-red-400'}`} />
                      <h3 className="font-bold">{site.domain}</h3>
                      {site.vercel && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-black font-bold">VERCEL</span>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <span className="mono text-[11px] px-2 py-1 rounded-full bg-white/10">{site.framework}</span>
                      <span className="mono text-[11px] px-2 py-1 rounded-full bg-white/5">:{site.port}</span>
                      {site.ssl && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">SSL ✓</span>}
                    </div>
                  </div>
                  <span className="mono text-[11px] text-white/40">{site.lastDeploy}</span>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={()=>handleDeploy(site)} disabled={deployingId===site.id} className={`flex-1 py-2 rounded-full text-[12px] font-bold transition ${deployingId===site.id?'bg-white/10':'bg-white text-black hover:bg-white/90'}`}>
                    {deployingId===site.id?'Deploying...':'Deploy'}
                  </button>
                  <button onClick={()=>handleRestart(site)} className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-[12px]">{site.status==='running'?'Stop':'Start'}</button>
                  <button onClick={()=>{document.getElementById('logs').scrollIntoView(); addLog(`> tail -f logs for ${site.domain}`);}} className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-[12px]">Logs</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="glass rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-bold text-[13px]">Live Deploy Logs</h3>
              <span className="mono text-[10px] text-white/40">AUTO SCROLL</span>
            </div>
            <div id="logs" className="mono h-[280px] overflow-auto bg-black/50 p-4 text-[11px] leading-5">
              {logs.map((l,i)=><div key={i} className={l.includes('✅')?'text-emerald-300': l.includes('>')?'text-white/80':'text-white/40'}>{l}</div>)}
            </div>
            <div className="p-3 bg-white/5 flex gap-2">
              <button onClick={()=>setLogs([])} className="text-[11px] px-3 py-1 rounded-full bg-white/10">Clear</button>
              <button onClick={()=>addLog('> Vercel deploy hook triggered')} className="text-[11px] px-3 py-1 rounded-full bg-violet-600 text-white">Push to Vercel</button>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="glass rounded-2xl w-full max-w-md p-6 glow">
            <h3 className="font-bold text-lg mb-4">Add New Website</h3>
            <div className="space-y-4">
              <div><label className="mono text-[11px] text-white/50">Domain</label><input value={newSite.domain} onChange={e=>setNewSite({...newSite, domain: e.target.value})} placeholder="baru.com" className="w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[14px] outline-none focus:border-violet-500/50" /></div>
              <div><label className="mono text-[11px] text-white/50">Git Repo URL</label><input value={newSite.repo} onChange={e=>setNewSite({...newSite, repo: e.target.value})} placeholder="https://github.com/..." className="w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[14px] outline-none focus:border-violet-500/50" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mono text-[11px] text-white/50">Framework</label><select value={newSite.framework} onChange={e=>setNewSite({...newSite, framework: e.target.value})} className="w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[14px]"><option>Next.js</option><option>Laravel</option><option>WordPress</option><option>Static</option><option>Node API</option></select></div>
                <div><label className="mono text-[11px] text-white/50">Port</label><input type="number" value={newSite.port} onChange={e=>setNewSite({...newSite, port: e.target.value})} className="w-full mt-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-[14px]" /></div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setShowModal(false)} className="flex-1 py-3 rounded-full bg-white/10 text-[13px]">Batal</button>
              <button onClick={handleAddSite} className="flex-1 py-3 rounded-full bg-white text-black font-bold text-[13px]">Tambah Website</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 right-6 glass rounded-full px-5 py-3 text-[13px] font-bold glow">{toast}</div>}
    </div>
  );
}

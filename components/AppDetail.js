import { useEffect, useState, useCallback } from 'react';
import { call, mb, fmtUptime } from './LiveVps';

const btn = 'px-4 py-2 rounded-full text-[12px] font-bold disabled:opacity-40 transition';

export default function AppDetail({ name, onClose, onLog, onJob, onChanged, onOpen }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [logs, setLogs] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { setInfo(await call(`apps/${encodeURIComponent(name)}/info`)); setErr(''); }
    catch (e) { setErr(e.message); }
  }, [name]);

  useEffect(() => { load(); }, [load]);

  const control = async (action) => {
    setBusy(action);
    onLog?.(`> pm2 ${action} ${name}`);
    try {
      await call(`apps/${encodeURIComponent(name)}/${action}`, 'POST');
      onLog?.(`✅ ${name} ${action} OK`);
      await load(); onChanged?.();
    } catch (e) { onLog?.(`❌ ${name} ${action} gagal: ${e.message}`); setErr(e.message); }
    setBusy('');
  };

  const update = async () => {
    const warn = `Update "${name}"?\n\nLangkah: git pull → install dependency → build → restart.\nProses akan mati beberapa saat. Bila ini bot trading, tekan Start lagi di dashboard bot setelah selesai.`;
    if (!confirm(warn)) return;
    setBusy('update');
    try {
      const d = await call(`apps/${encodeURIComponent(name)}/update`, 'POST');
      onLog?.(`> update ${name}`);
      onJob?.(d.job);
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  const remove = async () => {
    if (!confirm(`Hapus "${name}" dari pm2? File aplikasi di disk TIDAK dihapus.`)) return;
    setBusy('delete');
    try { await call(`apps/${encodeURIComponent(name)}/delete`, 'POST'); onLog?.(`✅ ${name} dihapus dari pm2`); onChanged?.(); onClose(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };

  const showLogs = async () => {
    setBusy('logs');
    try { setLogs((await call(`apps/${encodeURIComponent(name)}/logs`)).logs || '(kosong)'); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };

  const g = info?.git;
  const online = info?.status === 'online';
  const isSite = name.startsWith('site-');
  const canUpdate = g && !isSite;
  const upToDate = g && g.behind === 0 && !g.fetchError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-2xl p-6 glow max-h-full overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h3 className="font-bold text-lg truncate">{name}</h3>
            <p className="mono text-[11px] text-white/40 truncate">{info?.cwd || '...'}</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white text-xl leading-none px-2">×</button>
        </div>

        {err && <p className="text-[12px] text-red-400 mb-3">{err}</p>}
        {!info && !err && <p className="text-[13px] text-white/40">Memuat...</p>}

        {info && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                ['Status', <span key="s" className={online ? 'text-emerald-300' : 'text-red-300'}>{info.status}</span>],
                ['Uptime', info.uptime ? fmtUptime(info.uptime) : '-'],
                ['Memori', mb(info.memory)],
                ['Restart', info.restarts],
              ].map(([k, v]) => (
                <div key={k} className="bg-white/5 rounded-xl p-3">
                  <p className="text-[10px] text-white/40 tracking-widest">{k.toUpperCase()}</p>
                  <p className="mono text-[13px] mt-1">{v}</p>
                </div>
              ))}
            </div>

            <div className="bg-white/5 rounded-xl p-4 mb-4 text-[12px]">
              <p className="text-[10px] text-white/40 tracking-widest mb-2">AKSES</p>
              {info.urls?.length ? info.urls.map(u => (
                <div key={u.url} className="flex items-center justify-between gap-2 py-1">
                  <span className="mono text-white/80 truncate">{u.url}{u.auth && <span className="ml-2 text-emerald-300">🔐 login</span>}{!u.secure && <span className="ml-2 text-amber-300">http</span>}</span>
                  <button onClick={() => { onOpen?.(name, u.url); onClose(); }} className="px-3 py-1 rounded-full bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 font-bold shrink-0">Buka ↗</button>
                </div>
              )) : (
                <p className="text-white/40">{info.ports?.length ? `Aplikasi listen di port ${info.ports.join(', ')} tapi belum punya alamat publik. Pasang domain lewat + New Website → Import dari VPS.` : 'Proses ini tidak membuka port web.'}</p>
              )}
            </div>

            {g ? (
              <div className="bg-white/5 rounded-xl p-4 mb-4 text-[12px]">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="mono text-white/80">{g.branch} @ {g.commit}</span>
                  {g.fetchError ? <span className="text-amber-300">gagal cek GitHub</span>
                    : g.behind > 0 ? <span className="text-violet-300 font-bold">{g.behind} update tersedia</span>
                    : <span className="text-emerald-300">sudah terbaru</span>}
                </div>
                <p className="text-white/60 mt-2 truncate">{g.subject}</p>
                <p className="mono text-[11px] text-white/30 mt-1 truncate">{g.remote}</p>
                {g.dirty && <p className="text-amber-300 mt-2">⚠ Ada perubahan lokal belum di-commit di VPS. Update akan ditolak.</p>}
                {g.ahead > 0 && <p className="text-amber-300 mt-2">⚠ Ada {g.ahead} commit lokal di VPS yang belum di-push.</p>}
                {g.fetchError && <p className="text-white/40 mt-2 break-all">{g.fetchError}</p>}
              </div>
            ) : (
              <p className="text-[12px] text-white/40 mb-4">{isSite ? 'Website dikelola lewat bagian Websites.' : 'Bukan repo git, jadi tidak ada fitur update.'}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {canUpdate && <button onClick={update} disabled={!!busy || upToDate} className={`${btn} bg-white text-black`}>{g.behind > 0 ? `Update (${g.behind})` : 'Update'}</button>}
              {!info.protected && <button onClick={() => control('restart')} disabled={!!busy} className={`${btn} bg-white/10 hover:bg-white/15`}>{busy === 'restart' ? '...' : 'Restart'}</button>}
              {!info.protected && (online
                ? <button onClick={() => control('stop')} disabled={!!busy} className={`${btn} bg-white/10 hover:bg-white/15`}>Stop</button>
                : <button onClick={() => control('start')} disabled={!!busy} className={`${btn} bg-white/10 hover:bg-white/15`}>Start</button>)}
              <button onClick={showLogs} disabled={!!busy} className={`${btn} bg-white/10 hover:bg-white/15`}>{logs ? 'Muat ulang log' : 'Lihat log'}</button>
              <button onClick={load} disabled={!!busy} className={`${btn} bg-white/5 hover:bg-white/10`}>Cek update</button>
              {!info.protected && !isSite && !online && <button onClick={remove} disabled={!!busy} className={`${btn} bg-red-500/10 text-red-300 hover:bg-red-500/20`}>Hapus</button>}
            </div>
            {info.protected && <p className="text-[11px] text-white/30 mt-3">Proses ini dilindungi: tidak bisa distop atau dihapus dari dashboard{name === 'elnicko-agent' ? ', tapi bisa di-update (agent restart sendiri).' : '.'}</p>}

            {logs != null && (
              <pre className="mono mt-4 h-64 overflow-auto bg-black/50 rounded-xl p-3 text-[11px] leading-5 text-white/70 whitespace-pre-wrap break-all">{logs}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

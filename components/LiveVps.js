import { useCallback, useEffect, useState } from 'react';

async function call(path, method = 'GET') {
  const r = await fetch(`/api/vps/proxy?path=${encodeURIComponent(path)}`, { method });
  if (r.status === 401) { window.location.href = '/login'; throw new Error('Sesi habis'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

export const gb = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
export const mb = (b) => `${Math.round(b / 1024 ** 2)} MB`;

export function fmtUptime(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}j` : `${Math.floor(h / 24)}h`;
}

export function useVps(intervalMs = 10000) {
  const [status, setStatus] = useState(null);
  const [apps, setApps] = useState(null);
  const [error, setError] = useState('');
  const [mock, setMock] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([call('status'), call('apps')]);
      if (s.mock || a.mock) { setMock(true); setError(''); return; }
      setMock(false); setStatus(s); setApps(a.apps); setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { status, apps, error, mock, refresh, setApps };
}

export function VpsApps({ apps, error, mock, setApps, onLog }) {
  const [busy, setBusy] = useState(null);

  const act = async (name, action) => {
    if (!confirm(`${action.toUpperCase()} "${name}" di VPS?`)) return;
    setBusy(name);
    onLog?.(`> pm2 ${action} ${name}`);
    try {
      const d = await call(`apps/${encodeURIComponent(name)}/${action}`, 'POST');
      if (d.apps) setApps(d.apps);
      onLog?.(`✅ ${name} ${action} OK`);
    } catch (e) {
      onLog?.(`❌ ${name} ${action} gagal: ${e.message}`);
    }
    setBusy(null);
  };

  return (
    <div className="col-span-12 glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold">VPS Processes (pm2){apps ? ` • ${apps.length}` : ''}</h2>
        {mock && <span className="mono text-[11px] text-amber-300">MOCK • VPS_API_URL belum diset</span>}
        {error && <span className="mono text-[11px] text-red-400">{error}</span>}
      </div>
      {!apps && !error && !mock && <p className="text-[13px] text-white/40">Memuat...</p>}
      {apps && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="mono text-[11px] text-white/40 text-left">
                <th className="py-2 pr-4">NAME</th><th className="pr-4">STATUS</th><th className="pr-4">CPU</th>
                <th className="pr-4">MEM</th><th className="pr-4">UPTIME</th><th className="pr-4">↺</th><th />
              </tr>
            </thead>
            <tbody>
              {apps.map(a => (
                <tr key={a.name} className="border-t border-white/5">
                  <td className="py-2 pr-4 font-semibold">{a.name}</td>
                  <td className="pr-4">
                    <span className={a.status === 'online' ? 'text-emerald-300' : 'text-red-300'}>{a.status}</span>
                  </td>
                  <td className="pr-4 mono">{a.cpu}%</td>
                  <td className="pr-4 mono">{mb(a.memory)}</td>
                  <td className="pr-4 mono">{a.uptime ? fmtUptime(a.uptime) : '-'}</td>
                  <td className="pr-4 mono">{a.restarts}</td>
                  <td className="text-right whitespace-nowrap">
                    {a.protected ? (
                      <span className="mono text-[11px] text-white/30">dilindungi</span>
                    ) : (
                      <>
                        {a.status === 'online' ? (
                          <button disabled={busy === a.name} onClick={() => act(a.name, 'stop')} className="px-3 py-1 rounded-full border border-white/10 text-[12px] hover:bg-white/5 disabled:opacity-40 mr-2">Stop</button>
                        ) : (
                          <button disabled={busy === a.name} onClick={() => act(a.name, 'start')} className="px-3 py-1 rounded-full border border-white/10 text-[12px] hover:bg-white/5 disabled:opacity-40 mr-2">Start</button>
                        )}
                        <button disabled={busy === a.name} onClick={() => act(a.name, 'restart')} className="px-3 py-1 rounded-full bg-white text-black text-[12px] font-bold disabled:opacity-40">Restart</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

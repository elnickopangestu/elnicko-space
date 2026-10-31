import { useEffect, useState } from 'react';

// Menampilkan aplikasi VPS langsung di dalam dashboard (iframe).
// Browser memblokir http:// di dalam halaman https:// (mixed content), jadi hanya URL https yang bisa ditampilkan.
export function canEmbed(url) {
  if (typeof window === 'undefined') return false;
  return !(window.location.protocol === 'https:' && url.startsWith('http://'));
}

export default function AppViewer({ name, url, onClose }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => setSlow(true), 8000);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#06080f]">
      <div className="h-[52px] shrink-0 border-b border-white/10 glass flex items-center justify-between gap-3 px-4">
        <div className="min-w-0 flex items-center gap-3">
          <span className="font-bold text-[13px] truncate">{name}</span>
          <span className="mono text-[11px] text-white/40 truncate hidden sm:block">{url}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-[12px]">Tab baru ↗</a>
          <button onClick={onClose} className="px-4 py-2 rounded-full bg-white text-black text-[12px] font-bold">Tutup</button>
        </div>
      </div>
      <div className="relative flex-1">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/40 px-6 text-center">
            {slow ? 'Belum tampil? Aplikasi mungkin menolak ditampilkan di dalam halaman lain, atau meminta login. Coba "Tab baru ↗".' : 'Memuat...'}
          </div>
        )}
        <iframe
          src={url}
          title={name}
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 w-full h-full bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}

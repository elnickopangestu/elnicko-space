import { useState } from 'react';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) { window.location.href = '/'; return; }
      const d = await r.json().catch(() => ({}));
      setError(d.error || 'Login gagal');
    } catch {
      setError('Tidak bisa terhubung ke server');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#06080f] text-white flex items-center justify-center px-4" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">◐</div>
          <h1 className="font-bold tracking-widest text-[14px]">ELNICKO SPACE</h1>
        </div>
        <label className="block text-[12px] text-white/60 mb-2">Password</label>
        <input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-3 text-[16px] sm:text-[14px] outline-none focus:border-violet-500/50" />
        {error && <p className="text-[12px] text-red-400 mt-3">{error}</p>}
        <button disabled={loading || !password} className="mt-5 w-full px-4 py-2 rounded-full bg-white text-black text-[13px] font-bold disabled:opacity-50">
          {loading ? 'Masuk...' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}

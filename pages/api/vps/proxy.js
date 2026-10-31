// Hanya rute agent yang diizinkan, supaya proxy tidak bisa dipakai untuk path sembarang
const ALLOWED = [
  { method: 'GET', re: /^status$/ },
  { method: 'GET', re: /^apps$/ },
  { method: 'POST', re: /^apps\/[A-Za-z0-9._-]{1,64}\/(restart|stop|start)$/ },
];

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  const { VPS_API_URL, VPS_TOKEN } = process.env;

  if (!ALLOWED.some(r => r.method === req.method && r.re.test(path))) {
    return res.status(400).json({ error: 'Path tidak diizinkan' });
  }

  // Mock mode for local dev without VPS
  if (!VPS_API_URL) {
    return res.status(200).json({ success: true, mock: true, path });
  }

  try {
    const response = await fetch(`${VPS_API_URL.replace(/\/$/, '')}/${path}`, {
      method: req.method,
      headers: { 'Authorization': `Bearer ${VPS_TOKEN}` },
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Agent tidak bisa dihubungi: ${e.message}` });
  }
}

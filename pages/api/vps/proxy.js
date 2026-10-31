// Hanya rute agent yang diizinkan, supaya proxy tidak bisa dipakai untuk path sembarang
const D = '[A-Za-z0-9.-]{1,253}';
const ALLOWED = [
  { method: 'GET', re: /^overview$/ },
  { method: 'GET', re: /^status$/ },
  { method: 'GET', re: /^apps$/ },
  { method: 'POST', re: /^apps\/[A-Za-z0-9._-]{1,64}\/(restart|stop|start)$/ },
  { method: 'GET', re: /^sites$/ },
  { method: 'POST', re: /^sites$/, body: true },
  { method: 'GET', re: new RegExp(`^sites/${D}/logs$`) },
  { method: 'POST', re: new RegExp(`^sites/${D}/(deploy|ssl|delete|start|stop|restart)$`) },
  { method: 'GET', re: /^jobs\/[a-f0-9]{6,32}$/ },
];

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  const { VPS_API_URL, VPS_TOKEN } = process.env;

  const rule = ALLOWED.find(r => r.method === req.method && r.re.test(path));
  if (!rule) return res.status(400).json({ error: 'Path tidak diizinkan' });

  // Mock mode for local dev without VPS
  if (!VPS_API_URL) {
    return res.status(200).json({ success: true, mock: true, path });
  }

  try {
    const headers = { 'Authorization': `Bearer ${VPS_TOKEN}` };
    let body;
    if (rule.body) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body || {});
    }
    const response = await fetch(`${VPS_API_URL.replace(/\/$/, '')}/${path}`, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Agent tidak bisa dihubungi: ${e.message}` });
  }
}

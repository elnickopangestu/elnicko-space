
export default async function handler(req, res) {
  const { path } = req.query;
  const VPS_API_URL = process.env.VPS_API_URL || 'http://localhost:4000';
  const VPS_TOKEN = process.env.VPS_TOKEN || 'dev-token';
  
  // Mock mode for local dev without VPS
  if (!process.env.VPS_API_URL) {
    return res.status(200).json({ success: true, mock: true, path });
  }

  try {
    const response = await fetch(`${VPS_API_URL}/${path}`, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${VPS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, mock: true });
  }
}

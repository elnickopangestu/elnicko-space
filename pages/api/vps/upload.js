// Meneruskan potongan zip (binary) ke agent. Dipisah dari proxy.js karena butuh body mentah.
export const config = { api: { bodyParser: false } };

const MAX = 4.5 * 1024 * 1024; // batas payload fungsi Vercel

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX) throw new Error('Potongan terlalu besar');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).end();
  const id = String(req.query.id || '');
  const idx = String(req.query.idx || '');
  if (!/^[a-f0-9]{16}$/.test(id) || !/^\d{1,3}$/.test(idx)) return res.status(400).json({ error: 'Parameter tidak valid' });

  const { VPS_API_URL, VPS_TOKEN } = process.env;
  if (!VPS_API_URL) return res.status(200).json({ success: true, mock: true });

  try {
    const body = await readBody(req);
    const r = await fetch(`${VPS_API_URL.replace(/\/$/, '')}/uploads/${id}/${idx}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${VPS_TOKEN}`, 'Content-Type': 'application/octet-stream' },
      body,
      signal: AbortSignal.timeout(50000),
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Upload gagal: ${e.message}` });
  }
}

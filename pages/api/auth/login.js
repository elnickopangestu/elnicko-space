import { COOKIE, MAX_AGE, createSession, safeEqual } from '../../../lib/session';

const attempts = new Map(); // best-effort rate limit per instance

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { DASHBOARD_PASSWORD, SESSION_SECRET } = process.env;
  if (!DASHBOARD_PASSWORD || !SESSION_SECRET) {
    return res.status(500).json({ error: 'Server belum dikonfigurasi (DASHBOARD_PASSWORD / SESSION_SECRET)' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = now; }
  if (rec.n >= 5) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi 15 menit lagi' });

  const password = String(req.body?.password || '');
  if (!safeEqual(password, DASHBOARD_PASSWORD)) {
    rec.n += 1; attempts.set(ip, rec);
    return res.status(401).json({ error: 'Password salah' });
  }

  attempts.delete(ip);
  const token = await createSession(SESSION_SECRET);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`);
  res.status(200).json({ ok: true });
}

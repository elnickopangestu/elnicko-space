import { COOKIE } from '../../../lib/session';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.status(200).json({ ok: true });
}

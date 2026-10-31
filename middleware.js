import { NextResponse } from 'next/server';
import { COOKIE, verifySession } from './lib/session';

const PUBLIC = ['/login', '/api/auth/login'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.includes(pathname)) return NextResponse.next();

  const ok = await verifySession(req.cookies.get(COOKIE)?.value, process.env.SESSION_SECRET);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

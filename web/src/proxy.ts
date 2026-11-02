import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const isAdminLogin = request.nextUrl.pathname === '/admin/login';
  if (isAdminLogin) return NextResponse.next();
  if (
    request.cookies.has('daintyAccessToken') ||
    request.cookies.has('daintyRefreshToken')
  ) {
    return NextResponse.next();
  }
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const loginUrl = new URL('/admin/login', request.url);
  loginUrl.searchParams.set('next', next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*'],
};

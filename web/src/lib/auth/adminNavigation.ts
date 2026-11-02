const ADMIN_REDIRECT_KEY = 'dainty-admin-login-redirect';
const REDIRECT_LOOP_WINDOW_MS = 3_000;

export function sanitizeAdminNext(value: string | null | undefined): string {
  if (
    !value ||
    (!value.startsWith('/admin/') && value !== '/admin') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.startsWith('/admin/login')
  ) {
    return '/admin';
  }
  return value;
}

export function claimAdminLoginRedirect(): boolean {
  const now = Date.now();
  const previous = Number(sessionStorage.getItem(ADMIN_REDIRECT_KEY) ?? 0);
  if (previous > 0 && now - previous < REDIRECT_LOOP_WINDOW_MS) return false;
  sessionStorage.setItem(ADMIN_REDIRECT_KEY, String(now));
  return true;
}

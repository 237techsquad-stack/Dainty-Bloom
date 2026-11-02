import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminLoginForm } from '@/components/auth/AdminLoginForm';
import { Brand } from '@/components/layout/Brand';

export const metadata: Metadata = {
  title: 'Staff sign in',
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="auth-page admin-login-page" data-route-focus tabIndex={-1}>
      <section
        className="admin-login-card"
        aria-label="Dainty Bloom staff sign in"
      >
        <aside className="admin-login-brand-panel">
          <Brand />
          <div>
            <p className="admin-login-eyebrow">DAINTY BLOOM STUDIO</p>
            <h2>Made personal, made with care.</h2>
            <p className="admin-login-brand-note">
              A thoughtful place to manage the details behind every custom
              print.
            </p>
          </div>
        </aside>
        <div className="admin-login-form-panel">
          <AdminLoginForm />
          <Link className="admin-login-store-link" href="/">
            Return to the storefront
          </Link>
        </div>
      </section>
    </main>
  );
}

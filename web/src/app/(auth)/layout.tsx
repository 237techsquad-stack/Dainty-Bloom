import type { ReactNode } from 'react';
import { Brand } from '@/components/layout/Brand';
import { getPublicSettings } from '@/lib/api/server';

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { data: settings } = await getPublicSettings();

  return (
    <main className="auth-page" data-route-focus tabIndex={-1}>
      <section className="auth-card" aria-label="Dainty Bloom account">
        <aside className="auth-brand-panel">
          <Brand />
          {settings?.aboutNote ? <p>{settings.aboutNote}</p> : null}
        </aside>
        <div className="auth-form-panel">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

import type { ReactNode } from 'react';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { getPublicCategories, getPublicSettings } from '@/lib/api/server';

export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [settingsResult, categoriesResult] = await Promise.all([
    getPublicSettings(),
    getPublicCategories(),
  ]);
  const settings = settingsResult.data;
  const categories = categoriesResult.data;

  return (
    <>
      <Header settings={settings} />
      <main
        id="main-content"
        className="main-content"
        data-route-focus
        tabIndex={-1}
      >
        {children}
      </main>
      <Footer settings={settings} categories={categories} />
    </>
  );
}

'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';
import { QueryProvider } from './QueryProvider';
import { ToastProvider } from '@/components/ui';
import { RouteFocusManager } from '@/components/layout/RouteFocusManager';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>
          <RouteFocusManager />
          {children}
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

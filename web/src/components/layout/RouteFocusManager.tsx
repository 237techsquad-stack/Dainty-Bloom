'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function RouteFocusManager() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main[data-route-focus]')?.focus({
        preventScroll: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

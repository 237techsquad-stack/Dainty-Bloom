'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Frontend route error', error.digest ?? 'unavailable');
  }, [error]);

  return (
    <main className="message-page container" role="alert">
      <h1>This page could not be loaded</h1>
      <p>Please try again or return to the home page.</p>
      <div className="button-row">
        <Button onClick={reset}>Try again</Button>
        <Link className="button button--secondary" href="/">
          Back to home
        </Link>
      </div>
    </main>
  );
}

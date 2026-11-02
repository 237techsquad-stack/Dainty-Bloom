import { LoadingSkeleton, Spinner } from '@/components/ui';

export default function Loading() {
  return (
    <main className="message-page container" aria-busy="true">
      <Spinner label="Loading page" />
      <LoadingSkeleton className="loading-title" />
      <LoadingSkeleton className="loading-copy" />
    </main>
  );
}

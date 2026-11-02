import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="message-page container">
      <p className="eyebrow">404</p>
      <h1>We couldn’t find that page</h1>
      <p>The page may have moved or is not available.</p>
      <Link className="button button--primary" href="/">
        Back to home
      </Link>
    </main>
  );
}

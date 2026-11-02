'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, PackageSearch } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';

export function TrackOrderPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const normalizedEmail = email.trim();
      await api.lookupOrder(orderNumber.trim(), normalizedEmail);
      sessionStorage.setItem('daintyBloom:guest-order-email', normalizedEmail);
      router.push(`/orders/${encodeURIComponent(orderNumber.trim())}`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Order could not be found. Check the details and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="commerce-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Track order</span></nav>
      <form className="commerce-card track-form" onSubmit={(event) => void submit(event)}>
        <PackageSearch size={34} aria-hidden="true" />
        <h1>Track your order</h1>
        <p>Enter your order number and the email address used at checkout.</p>
        <Input label="Order number" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} autoComplete="off" required />
        <Input label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        {error ? <div className="commerce-alert commerce-alert--error" role="alert"><AlertCircle size={18} /><p>{error}</p></div> : null}
        <Button type="submit" loading={loading}>Find order</Button>
      </form>
    </div>
  );
}

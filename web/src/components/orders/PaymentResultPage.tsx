'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { useAuth } from '@/components/providers/AuthProvider';
import { api, ApiError } from '@/lib/api/client';

export function PaymentResultPage({
  orderNumber,
  cancelled = false,
}: {
  orderNumber: string;
  cancelled?: boolean;
}) {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [guestEmail, setGuestEmail] = useState('');
  const [guestEmailResolved, setGuestEmailResolved] = useState(false);
  const email = (user?.email ?? guestEmail) || undefined;
  const startedAt = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmationFinished, setConfirmationFinished] = useState(cancelled);
  const [confirmationError, setConfirmationError] = useState('');
  const [payError, setPayError] = useState('');
  const [paying, setPaying] = useState(false);
  const status = useQuery({
    queryKey: ['payment-status', orderNumber, email],
    queryFn: () => api.orderPaymentStatus(orderNumber, user ? undefined : email),
    enabled: !cancelled && confirmationFinished && Boolean(orderNumber && (user || email)),
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' &&
      !timedOut &&
      startedAt.current !== null &&
      Date.now() - startedAt.current < 45_000
        ? 3_000
        : false,
  });
  const order = useQuery({
    queryKey: ['order-payment-result', orderNumber, email],
    queryFn: () => user
      ? api.customerOrder(orderNumber)
      : api.lookupOrder(orderNumber, email ?? ''),
    enabled: !cancelled && status.data?.status === 'paid' && Boolean(email),
    retry: false,
  });

  useEffect(() => {
    let active = true;
    if (!user) {
      const savedEmail = sessionStorage.getItem('daintyBloom:guest-order-email');
      window.setTimeout(() => {
        if (!active) return;
        if (savedEmail) setGuestEmail(savedEmail);
        setGuestEmailResolved(true);
      }, 0);
    } else {
      window.setTimeout(() => {
        if (active) setGuestEmailResolved(true);
      }, 0);
    }
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (cancelled || !orderNumber || authLoading || (!user && !guestEmailResolved)) return;
    if (!user && !email) {
      window.setTimeout(() => {
        setConfirmationError('Enter your order email to confirm payment.');
        setConfirmationFinished(true);
      }, 0);
      return;
    }
    startedAt.current = Date.now();
    const timeout = window.setTimeout(() => setTimedOut(true), 45_000);
    let active = true;
    void api.confirmOrderPayment(orderNumber, user ? undefined : email)
      .catch((error: unknown) => {
        if (active) {
          setConfirmationError(
            error instanceof ApiError
              ? error.message
              : 'Payment confirmation has not completed yet.',
          );
        }
      })
      .finally(() => {
        if (active) setConfirmationFinished(true);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [authLoading, cancelled, email, guestEmailResolved, orderNumber, user]);

  async function tryPaymentAgain() {
    setPaying(true);
    setPayError('');
    try {
      const session = await api.startOrderPayment(orderNumber, user ? undefined : email);
      window.location.assign(session.checkoutUrl);
    } catch (error) {
      setPayError(error instanceof ApiError ? error.message : 'A new payment session could not be started.');
    } finally {
      setPaying(false);
    }
  }

  const paid = status.data?.status === 'paid';
  const stillPending =
    status.data?.status === 'pending' &&
    !timedOut;
  const hasArtwork = Boolean(order.data?.items.some((item) => item.artwork));

  if (!orderNumber) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <AlertCircle aria-hidden="true" />
        <h1>Order number missing</h1>
        <p>Use the tracking page to find your order.</p>
        <Button onClick={() => router.push('/track-order')}>Track an order</Button>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="commerce-page">
        <section className="commerce-card payment-result">
          <AlertCircle size={40} aria-hidden="true" />
          <h1>Payment was not completed</h1>
          <p>Your order is saved. You can try payment again, or view the order details.</p>
          {payError ? <p className="field-error" role="alert">{payError}</p> : null}
          <div className="payment-result__actions">
            <Button loading={paying} onClick={() => void tryPaymentAgain()}>Try payment again</Button>
            <Button variant="secondary" onClick={() => router.push(`/orders/${encodeURIComponent(orderNumber)}`)}>View order</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="commerce-page">
      <section className="commerce-card payment-result" aria-live="polite">
        {paid ? (
          <>
            <CheckCircle2 size={44} aria-hidden="true" />
            <h1>Payment confirmed</h1>
            <p>Order number <strong>{orderNumber}</strong></p>
            {hasArtwork ? <p>If your order includes artwork we will check it before printing.</p> : null}
            <div className="payment-result__actions">
              <Button onClick={() => router.push(`/orders/${encodeURIComponent(orderNumber)}`)}>View order</Button>
              <Button variant="secondary" onClick={() => router.push('/shop')}>Continue shopping</Button>
            </div>
          </>
        ) : confirmationFinished && (status.isError || status.data?.status === 'failed' || (!user && !email)) ? (
          <>
            <AlertCircle size={40} aria-hidden="true" />
            <h1>Payment not confirmed</h1>
            <p>{status.error instanceof ApiError ? status.error.message : confirmationError || 'The payment could not be confirmed. You can try again.'}</p>
            {payError ? <p className="field-error" role="alert">{payError}</p> : null}
            <div className="payment-result__actions">
              <Button loading={paying} onClick={() => void tryPaymentAgain()}>Try payment again</Button>
              <Button variant="secondary" onClick={() => router.push(`/orders/${encodeURIComponent(orderNumber)}`)}>View order</Button>
            </div>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={40} aria-label="Processing payment" />
            <h1>Processing your payment</h1>
            <p>{stillPending ? 'We are confirming your payment with the provider. This can take a few moments.' : 'We could not confirm the payment yet. Your order remains available to view.'}</p>
            {!confirmationFinished && confirmationError ? <p className="field-hint">{confirmationError}</p> : null}
            {confirmationFinished && !stillPending ? (
              <div className="payment-result__actions">
                <Button loading={paying} onClick={() => void tryPaymentAgain()}>Try payment again</Button>
                <Button variant="secondary" onClick={() => router.push(`/orders/${encodeURIComponent(orderNumber)}`)}>View order</Button>
              </div>
            ) : null}
            <p className="field-hint"><Link href="/shop">Continue shopping</Link></p>
          </>
        )}
      </section>
    </div>
  );
}

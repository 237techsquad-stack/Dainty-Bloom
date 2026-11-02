'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ChevronDown, LockKeyhole } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, Checkbox, Input, Textarea } from '@/components/ui';
import { useSettings } from '@/hooks/useSettings';
import { api, ApiError } from '@/lib/api/client';
import type { CreateOrderInput } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils/formatMoney';

const addressSchema = z.object({
  line1: z.string().trim().min(1, 'Enter the address line').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'Enter a town or city').max(120),
  state: z.string().trim().min(1, 'Enter a state or region').max(120),
  postalCode: z.string().trim().min(1, 'Enter a postal code').max(40),
  country: z.string().trim().min(2, 'Enter a country').max(100),
});

const checkoutSchema = z
  .object({
    contact: z.object({
      name: z.string().trim().min(1, 'Enter your name').max(120),
      email: z.string().trim().email('Enter a valid email address').max(254),
      phone: z.string().trim().max(40).optional(),
    }),
    shippingAddress: addressSchema,
    billingSameAsShipping: z.boolean(),
    billingAddress: addressSchema.nullable().optional(),
    customerNote: z
      .string()
      .trim()
      .max(500, 'Notes must be 500 characters or fewer')
      .optional(),
  })
  .superRefine((values, context) => {
    if (!values.billingSameAsShipping) {
      const billing = addressSchema.safeParse(values.billingAddress);
      if (!billing.success) {
        for (const issue of billing.error.issues) {
          context.addIssue({
            code: 'custom',
            path: ['billingAddress', ...issue.path],
            message: issue.message,
          });
        }
      }
    }
  });

type CheckoutValues = z.infer<typeof checkoutSchema>;
type AddressValues = CheckoutValues['shippingAddress'];

function emptyAddress(): AddressValues {
  return {
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  };
}

function defaultAddress(
  user: ReturnType<typeof useAuth>['user'],
): AddressValues {
  const address =
    user?.addresses.find((entry) => entry.isDefault) ?? user?.addresses[0];
  return address
    ? {
        line1: address.line1,
        line2: address.line2 ?? '',
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      }
    : emptyAddress();
}

export function CheckoutPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const settings = useSettings();
  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: api.cart,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const preview = useQuery({
    queryKey: ['checkout-preview'],
    queryFn: api.checkoutPreview,
    enabled: Boolean(cart.data?.items.length),
    staleTime: 0,
  });
  const [guestContinue, setGuestContinue] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [createdOrderNumber, setCreatedOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const defaultShipping = defaultAddress(user);
  const initialValues: CheckoutValues = {
    contact: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
    },
    shippingAddress: defaultShipping,
    billingSameAsShipping: true,
    billingAddress: null,
    customerNote: '',
  };
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: initialValues,
    values: initialValues,
    mode: 'onTouched',
  });
  const billingSame = useWatch({
    control: form.control,
    name: 'billingSameAsShipping',
  });
  const note = useWatch({ control: form.control, name: 'customerNote' }) ?? '';
  const mustReturnToCart = Boolean(
    cart.data && (!cart.data.items.length || cart.data.hasBlockingIssues),
  );

  useEffect(() => {
    if (mustReturnToCart) router.replace('/cart?notice=checkout');
  }, [mustReturnToCart, router]);

  if (authLoading || settings.isPending || cart.isPending) {
    return (
      <div className="commerce-page">
        <div
          className="commerce-skeleton"
          role="status"
          aria-label="Loading checkout"
        >
          <div className="commerce-skeleton__block" />
          <div className="commerce-skeleton__block" />
        </div>
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <AlertCircle aria-hidden="true" />
        <h1>Checkout settings could not be loaded</h1>
        <p>Please retry before continuing.</p>
        <Button variant="secondary" onClick={() => void settings.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (cart.isError || !cart.data) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <AlertCircle />
        <h1>Checkout is unavailable</h1>
        <p>
          {cart.error instanceof ApiError
            ? cart.error.message
            : 'Please return to your cart and try again.'}
        </p>
        <Button onClick={() => router.push('/cart')}>Return to cart</Button>
      </div>
    );
  }

  if (!cart.data.items.length || cart.data.hasBlockingIssues) {
    return (
      <div className="commerce-page commerce-state" role="status">
        <p>Returning to your cart so you can review the items.</p>
      </div>
    );
  }

  if (!user && !settings.data?.guestCheckoutEnabled) {
    return (
      <div className="commerce-page">
        <section className="commerce-card checkout-signin">
          <LockKeyhole size={32} aria-hidden="true" />
          <h1>Sign in to continue</h1>
          <p>Your cart will be kept while you sign in or create an account.</p>
          <div className="checkout-signin__actions">
            <Button onClick={() => router.push('/login?next=%2Fcheckout')}>
              Sign in
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push('/register?next=%2Fcheckout')}
            >
              Create account
            </Button>
          </div>
        </section>
      </div>
    );
  }

  if (!user && settings.data?.guestCheckoutEnabled && !guestContinue) {
    return (
      <div className="commerce-page">
        <section className="commerce-card checkout-signin">
          <h1>How would you like to continue?</h1>
          <p>
            You can sign in or create an account, or continue as a guest. Your
            cart will be kept.
          </p>
          <div className="checkout-signin__actions">
            <Button onClick={() => router.push('/login?next=%2Fcheckout')}>
              Sign in
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push('/register?next=%2Fcheckout')}
            >
              Create account
            </Button>
            <Button variant="ghost" onClick={() => setGuestContinue(true)}>
              Continue as guest
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const lines = preview.data?.lines ?? cart.data.items;
  const totals = preview.data;

  async function submit(values: CheckoutValues) {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const input: CreateOrderInput = {
        contact: {
          name: values.contact.name.trim(),
          email: values.contact.email.trim(),
          ...(values.contact.phone?.trim()
            ? { phone: values.contact.phone.trim() }
            : {}),
        },
        shippingAddress: values.shippingAddress,
        billingSameAsShipping: values.billingSameAsShipping,
        ...(!values.billingSameAsShipping
          ? { billingAddress: addressSchema.parse(values.billingAddress) }
          : {}),
        ...(values.customerNote?.trim()
          ? { customerNote: values.customerNote.trim() }
          : {}),
      };
      let idempotencyKey = sessionStorage.getItem(
        'daintyBloom:checkout-idempotency-key',
      );
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        sessionStorage.setItem(
          'daintyBloom:checkout-idempotency-key',
          idempotencyKey,
        );
      }
      const order = await api.createOrder(input, idempotencyKey);
      sessionStorage.removeItem('daintyBloom:checkout-idempotency-key');
      if (!user) {
        sessionStorage.setItem(
          'daintyBloom:guest-order-email',
          values.contact.email.trim(),
        );
      }
      setCreatedOrderNumber(order.orderNumber);
      try {
        const session = await api.startOrderPayment(
          order.orderNumber,
          user ? undefined : values.contact.email.trim(),
        );
        window.location.assign(session.checkoutUrl);
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : 'Please try again below.';
        setSubmitError(
          `Your order was saved, but Stripe Checkout could not be opened. ${message}`,
        );
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setSubmitError(error.message);
        if (error.code === 'CART_HAS_BLOCKING_ISSUES') {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['cart'] }),
            queryClient.invalidateQueries({ queryKey: ['checkout-preview'] }),
            queryClient.invalidateQueries({ queryKey: ['cart-summary'] }),
          ]);
        }
        mapServerFieldErrors(error, form.setError);
      } else {
        setSubmitError(
          'The order could not be placed. Your checkout attempt is saved so you can safely retry.',
        );
      }
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
    } finally {
      setSubmitting(false);
    }
  }

  async function retryPayment() {
    if (!createdOrderNumber) return;
    setSubmitting(true);
    try {
      const email =
        user?.email ??
        sessionStorage.getItem('daintyBloom:guest-order-email') ??
        undefined;
      const session = await api.startOrderPayment(
        createdOrderNumber,
        user ? undefined : email,
      );
      window.location.assign(session.checkoutUrl);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : 'Payment could not be started. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="commerce-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/cart">Cart</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Checkout</span>
      </nav>
      <div className="commerce-page__heading">
        <div>
          <h1>Checkout</h1>
          <p>Review your details before placing the order.</p>
        </div>
      </div>
      <div className="checkout-mobile-summary">
        <details className="commerce-card" open>
          <summary>
            Your order <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <OrderSummary
            lines={lines}
            totals={totals}
            currency={cart.data.totals.currency}
          />
        </details>
      </div>
      <div className="checkout-layout">
        <form
          className="checkout-form"
          onSubmit={form.handleSubmit(submit)}
          noValidate
        >
          {submitError ? (
            <div className="commerce-alert commerce-alert--error" role="alert">
              <AlertCircle size={18} />
              <p>{submitError}</p>
            </div>
          ) : null}
          {preview.data?.issues.length ? (
            <div className="commerce-alert" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <p>
                  Some cart items need attention before an order can be placed.
                </p>
                <ul>
                  {preview.data.issues.map((issue, index) => (
                    <li key={`${issue.itemId}-${issue.code}-${index}`}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
                <Link href="/cart">Review your cart</Link>
              </div>
            </div>
          ) : null}
          {preview.isError ? (
            <div className="commerce-alert commerce-alert--error" role="alert">
              <AlertCircle size={18} />
              <p>
                Checkout totals could not be refreshed. Please retry before
                placing your order.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void preview.refetch()}
              >
                Retry totals
              </Button>
            </div>
          ) : null}
          <section className="commerce-card checkout-section">
            <h2>
              <span className="checkout-step-number">1</span> Contact
            </h2>
            <div className="checkout-fields">
              <Input
                label="Full name"
                autoComplete="name"
                error={form.formState.errors.contact?.name?.message}
                {...form.register('contact.name')}
              />
              <Input
                label="Email address"
                type="email"
                autoComplete="email"
                error={form.formState.errors.contact?.email?.message}
                {...form.register('contact.email')}
              />
              <Input
                label="Phone (optional)"
                type="tel"
                autoComplete="tel"
                error={form.formState.errors.contact?.phone?.message}
                {...form.register('contact.phone')}
              />
            </div>
          </section>
          <section className="commerce-card checkout-section">
            <h2>
              <span className="checkout-step-number">2</span> Shipping address
            </h2>
            {user?.addresses.length ? (
              <label className="field">
                <span className="field-label">Use a saved address</span>
                <select
                  className="input"
                  defaultValue=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    const address = user.addresses[Number(event.target.value)];
                    if (!address) return;
                    form.setValue(
                      'shippingAddress',
                      {
                        line1: address.line1,
                        line2: address.line2 ?? '',
                        city: address.city,
                        state: address.state,
                        postalCode: address.postalCode,
                        country: address.country,
                      },
                      { shouldValidate: true },
                    );
                  }}
                >
                  <option value="">Choose a saved address</option>
                  {user.addresses.map((address, index) => (
                    <option key={address._id ?? index} value={index}>
                      {address.label} — {address.line1}, {address.city}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <AddressFields
              prefix="shippingAddress"
              register={form.register}
              errors={form.formState.errors.shippingAddress}
              countries={settings.data?.supportedCountries ?? []}
            />
            <Checkbox
              label="Billing address is the same as shipping"
              {...form.register('billingSameAsShipping', {
                onChange: (event) => {
                  if (
                    !event.target.checked &&
                    !form.getValues('billingAddress')
                  ) {
                    form.setValue('billingAddress', emptyAddress());
                  }
                },
              })}
            />
            {!billingSame ? (
              <div className="checkout-section">
                <h3>Billing address</h3>
                <AddressFields
                  prefix="billingAddress"
                  register={form.register}
                  errors={form.formState.errors.billingAddress}
                  countries={settings.data?.supportedCountries ?? []}
                />
              </div>
            ) : null}
            {form.formState.errors.billingAddress?.message ? (
              <p className="field-error" role="alert">
                {form.formState.errors.billingAddress.message}
              </p>
            ) : null}
          </section>
          <section className="commerce-card checkout-section">
            <h2>
              <span className="checkout-step-number">3</span> Notes
            </h2>
            <Textarea
              label="Order note (optional)"
              maxLength={500}
              error={form.formState.errors.customerNote?.message}
              {...form.register('customerNote')}
            />
            <p className="field-hint" aria-live="polite">
              {note.length}/500 characters
            </p>
          </section>
          <section className="commerce-card checkout-section">
            <h2>
              <span className="checkout-step-number">4</span> Review
            </h2>
            <OrderSummary
              lines={lines}
              totals={totals}
              currency={cart.data.totals.currency}
            />
            <p className="field-hint">
              You will be redirected to Stripe Checkout to pay securely.
            </p>
            {createdOrderNumber ? (
              <Button
                type="button"
                loading={submitting}
                onClick={() => void retryPayment()}
              >
                Try payment again
              </Button>
            ) : (
              <Button
                type="submit"
                loading={submitting}
                disabled={
                  preview.isError ||
                  preview.isFetching ||
                  !preview.data ||
                  preview.data.hasBlockingIssues
                }
              >
                Place order and pay
              </Button>
            )}
          </section>
        </form>
        <aside
          className="commerce-card commerce-summary"
          aria-label="Order summary"
        >
          <h2>Order summary</h2>
          <OrderSummary
            lines={lines}
            totals={totals}
            currency={cart.data.totals.currency}
          />
          <p className="commerce-summary__note">
            <Link href="/cart">Return to cart</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

function AddressFields({
  prefix,
  register,
  errors,
  countries,
}: {
  prefix: 'shippingAddress' | 'billingAddress';
  register: ReturnType<typeof useForm<CheckoutValues>>['register'];
  errors: ReturnType<
    typeof useForm<CheckoutValues>
  >['formState']['errors']['shippingAddress'];
  countries: string[];
}) {
  const path = (field: keyof AddressValues) => `${prefix}.${field}` as const;
  return (
    <div className="checkout-fields">
      <Input
        label="Address line 1"
        autoComplete="address-line1"
        error={errors?.line1?.message}
        {...register(path('line1'))}
      />
      <Input
        label="Address line 2 (optional)"
        autoComplete="address-line2"
        error={errors?.line2?.message}
        {...register(path('line2'))}
      />
      <Input
        label="City / town"
        autoComplete="address-level2"
        error={errors?.city?.message}
        {...register(path('city'))}
      />
      <Input
        label="State / region"
        autoComplete="address-level1"
        error={errors?.state?.message}
        {...register(path('state'))}
      />
      <Input
        label="Postal code"
        autoComplete="postal-code"
        error={errors?.postalCode?.message}
        {...register(path('postalCode'))}
      />
      {countries.length ? (
        <label className="field">
          <span className="field-label">Country</span>
          <select
            className="input"
            autoComplete="country-name"
            aria-invalid={Boolean(errors?.country)}
            {...register(path('country'))}
          >
            <option value="">Select a country</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
          {errors?.country?.message ? (
            <span className="field-error">{errors.country.message}</span>
          ) : null}
        </label>
      ) : (
        <Input
          label="Country"
          autoComplete="country-name"
          error={errors?.country?.message}
          {...register(path('country'))}
        />
      )}
    </div>
  );
}

function OrderSummary({
  lines,
  totals,
  currency,
}: {
  lines: Array<{
    itemId: string;
    title: string;
    quantity: number;
    lineTotalMinor: number;
    selectedOptions: Array<{ label: string; valueLabel: string }>;
    artworkStatus: string;
  }>;
  totals?: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  currency: string;
}) {
  return (
    <div className="order-items-mini">
      {lines.map((line) => (
        <div className="order-items-mini__row" key={line.itemId}>
          <div>
            <p>
              <strong>{line.title}</strong> × {line.quantity}
            </p>
            {line.selectedOptions.length ? (
              <p className="order-items-mini__options">
                {line.selectedOptions
                  .map((option) => `${option.label}: ${option.valueLabel}`)
                  .join(' · ')}
              </p>
            ) : null}
            {line.artworkStatus !== 'none' ? (
              <p className="order-items-mini__options">
                Artwork: {line.artworkStatus.replaceAll('_', ' ')}
              </p>
            ) : null}
          </div>
          <strong>{formatMoney(line.lineTotalMinor, currency)}</strong>
        </div>
      ))}
      {totals ? (
        <>
          <div className="commerce-row">
            <span>Subtotal</span>
            <span>{formatMoney(totals.subtotalMinor, currency)}</span>
          </div>
          {totals.discountMinor > 0 ? (
            <div className="commerce-row">
              <span>Discount</span>
              <span>−{formatMoney(totals.discountMinor, currency)}</span>
            </div>
          ) : null}
          <div className="commerce-row">
            <span>Shipping</span>
            <span>{formatMoney(totals.shippingMinor, currency)}</span>
          </div>
          {totals.taxMinor > 0 ? (
            <div className="commerce-row">
              <span>Tax</span>
              <span>{formatMoney(totals.taxMinor, currency)}</span>
            </div>
          ) : null}
          <div className="commerce-row commerce-summary__total">
            <span>Total</span>
            <span>{formatMoney(totals.totalMinor, currency)}</span>
          </div>
        </>
      ) : (
        <p className="field-hint">Refreshing totals…</p>
      )}
    </div>
  );
}

function mapServerFieldErrors(
  error: ApiError,
  setError: ReturnType<typeof useForm<CheckoutValues>>['setError'],
) {
  if (!Array.isArray(error.details)) return;
  for (const issue of error.details) {
    if (
      typeof issue === 'object' &&
      issue !== null &&
      'path' in issue &&
      Array.isArray(issue.path) &&
      'message' in issue &&
      typeof issue.message === 'string'
    ) {
      const path = issue.path.map(String).join('.');
      if (
        path.startsWith('contact.') ||
        path.startsWith('shippingAddress.') ||
        path.startsWith('billingAddress.') ||
        path === 'customerNote'
      ) {
        setError(path as Parameters<typeof setError>[0], {
          message: issue.message,
        });
      }
    }
  }
}

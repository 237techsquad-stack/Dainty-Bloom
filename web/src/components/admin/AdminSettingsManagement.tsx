'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/admin';
import { Button, ErrorState } from '@/components/ui';
import { ApiError, api } from '@/lib/api/client';
import type { AdminSettings } from '@/lib/api/types';

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'The request could not be completed.';
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}

function moneyText(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2);
}

export function AdminSettingsManagement() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: api.adminSettings,
    retry: false,
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const save = useMutation({
    mutationFn: (input: Partial<AdminSettings>) =>
      api.updateAdminSettings(input),
    onSuccess: async () => {
      setError('');
      setSaved('Settings saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]);
    },
    onError: (reason) => {
      setSaved('');
      setError(errorMessage(reason));
    },
  });

  function submitStorefront(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings.data) return;
    const data = new FormData(event.currentTarget);
    const input: Partial<AdminSettings> = {
      storeName: String(data.get('storeName') ?? '').trim(),
      country: String(data.get('country') ?? '')
        .trim()
        .toUpperCase(),
      turnaroundMessage: String(data.get('turnaroundMessage') ?? ''),
      aboutNote: String(data.get('aboutNote') ?? ''),
      announcementBar: {
        enabled: data.get('announcementEnabled') === 'on',
        text: String(data.get('announcementText') ?? ''),
      },
      contactEmail: String(data.get('contactEmail') ?? '').trim(),
      contactPhone: String(data.get('contactPhone') ?? '').trim(),
      whatsappNumber: String(data.get('whatsappNumber') ?? '').trim(),
      contact: {
        ...settings.data.contact,
        email: String(data.get('contactEmail') ?? '').trim(),
        phone: String(data.get('contactPhone') ?? '').trim(),
        address: String(data.get('contactAddress') ?? ''),
        openingHours: String(data.get('contactHours') ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      },
      socialLinks: {
        instagram: String(data.get('instagram') ?? '').trim(),
        tiktok: String(data.get('tiktok') ?? '').trim(),
        whatsapp: String(data.get('socialWhatsapp') ?? '').trim(),
      },
      studioAddress: {
        label: String(data.get('studioLabel') ?? '').trim(),
        city: String(data.get('studioCity') ?? '').trim(),
        country: String(data.get('studioCountry') ?? '').trim(),
      },
      openingHoursDisplayText: String(
        data.get('openingHoursDisplayText') ?? '',
      ),
      guestCheckoutEnabled: data.get('guestCheckoutEnabled') === 'on',
    };
    setSaved('');
    save.mutate(input);
  }

  function submitOperations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings.data) return;
    const data = new FormData(event.currentTarget);
    const shippingFlatMinor = parseMoney(
      String(data.get('shippingFlat') ?? ''),
    );
    const thresholdText = String(data.get('freeShippingThreshold') ?? '');
    const freeShippingThresholdMinor = thresholdText
      ? parseMoney(thresholdText)
      : null;
    const taxRate = Number(data.get('taxRate') ?? 0);
    const maxBytes = Number(data.get('artworkMaxBytes') ?? 0);
    const allowedMimeTypes = String(data.get('artworkMimeTypes') ?? '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    if (
      shippingFlatMinor === null ||
      (thresholdText && freeShippingThresholdMinor === null)
    ) {
      setError(
        'Enter valid non-negative shipping amounts with up to two decimal places.',
      );
      setSaved('');
      return;
    }
    if (
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate > 100 ||
      !Number.isInteger(taxRate * 100)
    ) {
      setError('Tax rate must be from 0 to 100 with up to two decimal places.');
      setSaved('');
      return;
    }
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      !allowedMimeTypes.length
    ) {
      setError('Artwork size and at least one allowed MIME type are required.');
      setSaved('');
      return;
    }
    setError('');
    setSaved('');
    save.mutate({
      shippingFlatMinor,
      freeShippingThresholdMinor,
      taxRateBasisPoints: Math.round(taxRate * 100),
      shippingConfigured: data.get('shippingConfigured') === 'on',
      taxConfigured: data.get('taxConfigured') === 'on',
      orderCancellationWindowNote: String(data.get('cancellationNote') ?? ''),
      artworkLimits: { maxBytes, allowedMimeTypes },
    });
  }

  function submitContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings.data) return;
    const data = new FormData(event.currentTarget);
    let openingHours: AdminSettings['openingHours'];
    let productLines: AdminSettings['productLines'];
    try {
      openingHours = JSON.parse(
        String(data.get('openingHoursJson') ?? '[]'),
      ) as AdminSettings['openingHours'];
      productLines = JSON.parse(
        String(data.get('productLinesJson') ?? '[]'),
      ) as AdminSettings['productLines'];
    } catch {
      setError('Opening hours and product lines must be valid JSON.');
      setSaved('');
      return;
    }
    setError('');
    setSaved('');
    save.mutate({ openingHours, productLines });
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure storefront details and operational options already supported by the API."
      />
      {settings.isPending ? (
        <section className="admin-panel" role="status">
          Loading settings…
        </section>
      ) : settings.isError ? (
        <section className="admin-panel">
          <ErrorState title="Settings could not be loaded">
            {errorMessage(settings.error)}
          </ErrorState>
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            Try again
          </Button>
        </section>
      ) : (
        <>
          {error ? (
            <p className="admin-operation-error" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="admin-operation-success" role="status">
              {saved}
            </p>
          ) : null}
          <form
            className="admin-panel admin-operation-form"
            onSubmit={submitStorefront}
          >
            <h2>Storefront and contact</h2>
            <p>
              Only public-facing content and display settings are edited here.
              No credential or payment secrets are exposed.
            </p>
            <div className="admin-operation-form-grid">
              <label>
                Store name
                <input
                  className="input"
                  name="storeName"
                  required
                  maxLength={120}
                  defaultValue={settings.data.storeName}
                />
              </label>
              <label>
                Store currency
                <input
                  className="input"
                  required
                  value={settings.data.currency}
                  readOnly
                  aria-describedby="store-currency-note"
                />
                <small id="store-currency-note">
                  Currency changes require the USD-to-GBP migration. Historical
                  orders retain their recorded currency.
                </small>
              </label>
              <label>
                Country code
                <input
                  className="input"
                  name="country"
                  required
                  pattern="[A-Za-z]{2}"
                  maxLength={2}
                  defaultValue={settings.data.country}
                />
              </label>
              <label>
                Contact email
                <input
                  className="input"
                  name="contactEmail"
                  type="email"
                  maxLength={254}
                  defaultValue={
                    settings.data.contactEmail || settings.data.contact.email
                  }
                />
              </label>
              <label>
                Contact phone
                <input
                  className="input"
                  name="contactPhone"
                  maxLength={30}
                  defaultValue={
                    settings.data.contactPhone || settings.data.contact.phone
                  }
                />
              </label>
              <label>
                WhatsApp number
                <input
                  className="input"
                  name="whatsappNumber"
                  maxLength={30}
                  defaultValue={settings.data.whatsappNumber}
                />
              </label>
              <label>
                Instagram URL
                <input
                  className="input"
                  name="instagram"
                  type="url"
                  defaultValue={settings.data.socialLinks.instagram}
                />
              </label>
              <label>
                TikTok URL
                <input
                  className="input"
                  name="tiktok"
                  type="url"
                  defaultValue={settings.data.socialLinks.tiktok}
                />
              </label>
              <label>
                WhatsApp URL
                <input
                  className="input"
                  name="socialWhatsapp"
                  type="url"
                  defaultValue={settings.data.socialLinks.whatsapp}
                />
              </label>
              <label>
                Studio address label
                <input
                  className="input"
                  name="studioLabel"
                  maxLength={160}
                  defaultValue={settings.data.studioAddress.label}
                />
              </label>
              <label>
                Studio city
                <input
                  className="input"
                  name="studioCity"
                  maxLength={120}
                  defaultValue={settings.data.studioAddress.city}
                />
              </label>
              <label>
                Studio country
                <input
                  className="input"
                  name="studioCountry"
                  maxLength={120}
                  defaultValue={settings.data.studioAddress.country}
                />
              </label>
            </div>
            <label>
              Address shown in contact details
              <textarea
                className="input"
                name="contactAddress"
                rows={2}
                maxLength={500}
                defaultValue={settings.data.contact.address}
              />
            </label>
            <label>
              Contact hours (one line per entry)
              <textarea
                className="input"
                name="contactHours"
                rows={3}
                defaultValue={settings.data.contact.openingHours.join('\n')}
              />
            </label>
            <label>
              Opening hours display text
              <input
                className="input"
                name="openingHoursDisplayText"
                maxLength={300}
                defaultValue={settings.data.openingHoursDisplayText}
              />
            </label>
            <label>
              Turnaround message
              <textarea
                className="input"
                name="turnaroundMessage"
                rows={2}
                maxLength={1000}
                defaultValue={settings.data.turnaroundMessage}
              />
            </label>
            <label>
              About note
              <textarea
                className="input"
                name="aboutNote"
                rows={3}
                maxLength={2000}
                defaultValue={settings.data.aboutNote}
              />
            </label>
            <label className="admin-operation-checkbox">
              <input
                type="checkbox"
                name="announcementEnabled"
                defaultChecked={settings.data.announcementBar.enabled}
              />{' '}
              Show announcement bar
            </label>
            <label>
              Announcement text
              <textarea
                className="input"
                name="announcementText"
                rows={2}
                maxLength={500}
                defaultValue={settings.data.announcementBar.text}
              />
            </label>
            <label className="admin-operation-checkbox">
              <input
                type="checkbox"
                name="guestCheckoutEnabled"
                defaultChecked={settings.data.guestCheckoutEnabled}
              />{' '}
              Allow guest checkout
            </label>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save storefront settings'}
            </Button>
          </form>

          <form
            className="admin-panel admin-operation-form"
            onSubmit={submitOperations}
          >
            <h2>Shipping, tax and artwork limits</h2>
            <p>
              Amounts use {settings.data.currency} and are converted to minor
              units before submission.
            </p>
            <div className="admin-operation-form-grid">
              <label>
                Flat shipping amount
                <input
                  className="input"
                  name="shippingFlat"
                  inputMode="decimal"
                  required
                  defaultValue={moneyText(settings.data.shippingFlatMinor)}
                />
              </label>
              <label>
                Free shipping threshold (optional)
                <input
                  className="input"
                  name="freeShippingThreshold"
                  inputMode="decimal"
                  defaultValue={moneyText(
                    settings.data.freeShippingThresholdMinor,
                  )}
                />
              </label>
              <label>
                Tax rate (%)
                <input
                  className="input"
                  name="taxRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  defaultValue={(
                    settings.data.taxRateBasisPoints / 100
                  ).toFixed(2)}
                />
              </label>
              <label>
                Maximum artwork size (bytes)
                <input
                  className="input"
                  name="artworkMaxBytes"
                  type="number"
                  min="1"
                  step="1"
                  required
                  defaultValue={settings.data.artworkLimits.maxBytes}
                />
              </label>
            </div>
            <label>
              Allowed artwork MIME types (comma separated)
              <input
                className="input"
                name="artworkMimeTypes"
                required
                defaultValue={settings.data.artworkLimits.allowedMimeTypes.join(
                  ', ',
                )}
              />
            </label>
            <label>
              Cancellation window note
              <textarea
                className="input"
                name="cancellationNote"
                rows={2}
                maxLength={1000}
                defaultValue={settings.data.orderCancellationWindowNote}
              />
            </label>
            <label className="admin-operation-checkbox">
              <input
                type="checkbox"
                name="shippingConfigured"
                defaultChecked={settings.data.shippingConfigured}
              />{' '}
              Shipping rates are configured
            </label>
            <label className="admin-operation-checkbox">
              <input
                type="checkbox"
                name="taxConfigured"
                defaultChecked={settings.data.taxConfigured}
              />{' '}
              Tax calculation is configured
            </label>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save operational settings'}
            </Button>
          </form>

          <form
            className="admin-panel admin-operation-form"
            onSubmit={submitContent}
          >
            <h2>Product lines and opening schedule</h2>
            <p>
              These structured values are validated by the API. Keep the JSON
              arrays valid before saving.
            </p>
            <label>
              Opening schedule (JSON array)
              <textarea
                className="input admin-operation-code"
                name="openingHoursJson"
                rows={7}
                spellCheck={false}
                defaultValue={JSON.stringify(
                  settings.data.openingHours,
                  null,
                  2,
                )}
              />
            </label>
            <label>
              Product lines (JSON array)
              <textarea
                className="input admin-operation-code"
                name="productLinesJson"
                rows={10}
                spellCheck={false}
                defaultValue={JSON.stringify(
                  settings.data.productLines,
                  null,
                  2,
                )}
              />
            </label>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save content configuration'}
            </Button>
          </form>
        </>
      )}
    </>
  );
}

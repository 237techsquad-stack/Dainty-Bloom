export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = 'en-GB',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(minorToMajor(amountMinor, currency, locale));
}

export function minorToMajor(
  amountMinor: number,
  currency: string,
  locale = 'en-GB',
): number {
  const fractionDigits =
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return Number((amountMinor / 10 ** fractionDigits).toFixed(fractionDigits));
}

export function currencySymbol(currency: string, locale = 'en-GB'): string {
  return (
    new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

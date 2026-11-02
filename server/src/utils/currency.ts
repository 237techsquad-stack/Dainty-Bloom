export const STORE_CURRENCY = 'GBP';

const USD_TO_GBP_NUMERATOR = 752_627n;
const USD_TO_GBP_DENOMINATOR = 1_000_000n;

export function convertUsdMinorToGbpMinor(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error('USD minor-unit amounts must be safe integers');
  }

  const amount = BigInt(amountMinor);
  const absoluteAmount = amount < 0n ? -amount : amount;
  const converted =
    (absoluteAmount * USD_TO_GBP_NUMERATOR + USD_TO_GBP_DENOMINATOR / 2n) /
    USD_TO_GBP_DENOMINATOR;
  const signedConverted = amount < 0n ? -converted : converted;
  const result = Number(signedConverted);

  if (!Number.isSafeInteger(result)) {
    throw new Error('Converted GBP minor-unit amount exceeds the safe range');
  }

  return result;
}

export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = 'en-GB',
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** fractionDigits);
}

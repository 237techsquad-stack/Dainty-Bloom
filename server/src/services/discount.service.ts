export interface DiscountCalculation {
  discountMinor: number;
  code?: string;
}

export function calculateDiscount(_subtotalMinor: number): DiscountCalculation {
  return { discountMinor: 0 };
}

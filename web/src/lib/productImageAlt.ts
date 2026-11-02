const genericAltText =
  /^(?:image|photo|product image|product photo|image of (?:the )?product|n\/a|none)(?:\s*\d+)?$/i;

export function getProductImageAlt(
  productTitle: string,
  altText: string | null | undefined,
): string {
  const alt = altText?.trim();
  if (alt && !genericAltText.test(alt)) return alt;
  return `${productTitle.trim() || 'Product'} product photo`;
}

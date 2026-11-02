import type { Category, SearchSuggestion } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCategory(value: unknown): value is Category {
  if (!isRecord(value)) return false;
  return (
    typeof value._id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.sortOrder === 'number' &&
    typeof value.productCount === 'number' &&
    Array.isArray(value.children) &&
    value.children.every(isCategory)
  );
}

export function normalizeCategoryList(value: unknown): Category[] {
  return Array.isArray(value) ? value.filter(isCategory) : [];
}

export function isSearchSuggestion(value: unknown): value is SearchSuggestion {
  return (
    isRecord(value) &&
    (value.type === 'product' || value.type === 'category') &&
    typeof value.title === 'string' &&
    typeof value.slug === 'string'
  );
}

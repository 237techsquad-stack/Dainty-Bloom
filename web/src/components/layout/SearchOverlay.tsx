'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { isSearchSuggestion } from '@/lib/api/normalizers';
import type { SearchSuggestion } from '@/lib/api/types';
import { Button, Modal } from '@/components/ui';

export function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const suggestionsId = useId();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [active, setActive] = useState(-1);
  const suggestionsQuery = useQuery({
    queryKey: ['search-suggestions', debouncedQuery],
    queryFn: () => api.suggestions(debouncedQuery),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });
  const suggestions = Array.isArray(suggestionsQuery.data?.suggestions)
    ? suggestionsQuery.data.suggestions.filter(isSearchSuggestion)
    : [];
  const showSuggestions = debouncedQuery.length >= 2;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setActive(-1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function navigateToSuggestion(suggestion: SearchSuggestion) {
    onClose();
    router.push(
      suggestion.type === 'category'
        ? `/category/${suggestion.slug}`
        : `/shop?q=${encodeURIComponent(suggestion.title)}`,
    );
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    onClose();
    router.push(`/shop?q=${encodeURIComponent(term)}`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Search products"
      initialFocusRef={inputRef}
    >
      <div className="search-overlay">
        <form
          className="search-overlay__form"
          role="search"
          onSubmit={submitSearch}
        >
          <label className="visually-hidden" htmlFor={inputId}>
            Search products
          </label>
          <Search aria-hidden="true" size={20} />
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={suggestionsId}
            aria-expanded={open && showSuggestions}
            aria-activedescendant={
              active >= 0 ? `${suggestionsId}-option-${active}` : undefined
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && suggestions.length) {
                event.preventDefault();
                setActive((index) => (index + 1) % suggestions.length);
              } else if (event.key === 'ArrowUp' && suggestions.length) {
                event.preventDefault();
                setActive((index) =>
                  index <= 0 ? suggestions.length - 1 : index - 1,
                );
              } else if (
                event.key === 'Enter' &&
                active >= 0 &&
                suggestions[active]
              ) {
                event.preventDefault();
                navigateToSuggestion(suggestions[active]);
              }
            }}
          />
          <Button type="submit" aria-label="Submit search">
            Search
          </Button>
          <button
            className="search-overlay__close"
            type="button"
            title="Close search"
            aria-label="Close search"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </form>
        {showSuggestions ? (
          <div
            className="search-overlay__suggestions"
            id={suggestionsId}
            role="listbox"
            aria-label="Search suggestions"
            aria-live="polite"
          >
            {suggestionsQuery.isFetching ? (
              <p className="suggestions-status">Searching…</p>
            ) : suggestionsQuery.isError ? (
              <p className="suggestions-status" role="status">
                Suggestions are unavailable.
              </p>
            ) : suggestions.length === 0 ? (
              <p className="suggestions-status" role="status">
                No matches found.
              </p>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.type}-${suggestion.slug}`}
                  id={`${suggestionsId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active === index}
                  className={
                    active === index ? 'suggestion is-active' : 'suggestion'
                  }
                  onMouseEnter={() => setActive(index)}
                  onClick={() => navigateToSuggestion(suggestion)}
                >
                  <span>{suggestion.title}</span>
                  <small>
                    {suggestion.type === 'product' ? 'Product' : 'Category'}
                  </small>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

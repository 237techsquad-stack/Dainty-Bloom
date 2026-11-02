'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api/client';
import { Button, FieldError } from '@/components/ui';
import { currencySymbol } from '@/lib/utils/formatMoney';

export function moneyMinorFromText(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ''] = trimmed.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function textFromMinor(value?: number) {
  if (value === undefined || !Number.isSafeInteger(value)) return '';
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function MoneyInput({
  label,
  valueMinor,
  currency,
  onChange,
  error,
  disabled,
  id,
}: {
  label: string;
  valueMinor?: number;
  currency: string;
  onChange: (value: number | undefined) => void;
  error?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState(() => ({
    source: valueMinor,
    text: textFromMinor(valueMinor),
  }));
  const text =
    draft.source === valueMinor ? draft.text : textFromMinor(valueMinor);
  const invalid = text !== '' && moneyMinorFromText(text) === undefined;
  const symbol = useMemo(() => currencySymbol(currency), [currency]);
  const fieldId =
    id ?? `money-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="money-input">
        <span aria-hidden="true">{symbol}</span>
        <input
          id={fieldId}
          className="input"
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          aria-invalid={Boolean(error || invalid)}
          onChange={(event) => {
            const next = event.target.value;
            const minor = moneyMinorFromText(next);
            const valid = next === '' || minor !== undefined;
            setDraft({ source: valid ? minor : valueMinor, text: next });
            if (valid) onChange(minor);
          }}
        />
      </div>
      {invalid ? (
        <FieldError>
          Enter a non-negative amount with up to two decimal places.
        </FieldError>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

export function Repeater<T>({
  label,
  rows,
  createRow,
  onChange,
  renderRow,
  disabled,
}: {
  label: string;
  rows: T[];
  createRow: () => T;
  onChange: (rows: T[]) => void;
  renderRow: (row: T, index: number) => ReactNode;
  disabled?: boolean;
}) {
  function move(index: number, delta: number) {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <fieldset className="admin-repeater" disabled={disabled}>
      <legend>{label}</legend>
      {rows.map((row, index) => (
        <div className="admin-repeater-row" key={index}>
          <div className="admin-repeater-fields">{renderRow(row, index)}</div>
          <div className="admin-repeater-actions">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${label} row ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${label} row ${index + 1} down`}
              disabled={index === rows.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </Button>
            <Button
              size="sm"
              variant="danger"
              aria-label={`Remove ${label} row ${index + 1}`}
              onClick={() =>
                onChange(rows.filter((_, rowIndex) => rowIndex !== index))
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => onChange([...rows, createRow()])}
      >
        Add {label}
      </Button>
    </fieldset>
  );
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <select
        className="input"
        value=""
        disabled={disabled}
        aria-label={`Add ${label}`}
        onChange={(event) => {
          const next = event.target.value;
          if (next && !value.includes(next)) onChange([...value, next]);
        }}
      >
        <option value="">Choose an option</option>
        {options
          .filter((option) => !value.includes(option))
          .map((option) => (
            <option key={option} value={option}>
              {option.replaceAll('_', ' ')}
            </option>
          ))}
      </select>
      <div className="admin-chip-list" aria-label={`Selected ${label}`}>
        {value.map((item) => (
          <span className="admin-chip" key={item}>
            {item.replaceAll('_', ' ')}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              disabled={disabled}
              onClick={() =>
                onChange(value.filter((selected) => selected !== item))
              }
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="admin-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  error,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; depth?: number }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () =>
      options.filter((option) =>
        option.label.toLowerCase().includes(query.toLowerCase()),
      ),
    [options, query],
  );
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="input"
        type="search"
        value={query}
        disabled={disabled}
        placeholder={`Search ${label.toLowerCase()}`}
        aria-label={`Filter ${label}`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        className="input"
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {filtered.map((option) => (
          <option key={option.value} value={option.value}>
            {'— '.repeat(option.depth ?? 0)}
            {option.label}
          </option>
        ))}
      </select>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

export function CharacterCounter({
  value,
  max,
  label,
}: {
  value: string;
  max: number;
  label: string;
}) {
  return (
    <p className="admin-character-counter" aria-live="polite">
      {label}: {value.length}/{max}
    </p>
  );
}

export function ImageDropzone({
  disabled,
  onFiles,
}: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <label
      className={`admin-image-dropzone${disabled ? ' is-disabled' : ''}`}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      <strong>Choose or drop product images</strong>
      <span>JPEG, PNG or WebP · max 10 MB · shortest side at least 600 px</span>
    </label>
  );
}

export function StickySaveBar({
  onSave,
  onDiscard,
  saving,
  saveLabel = 'Save changes',
}: {
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  return (
    <div
      className="admin-sticky-save"
      role="region"
      aria-label="Unsaved changes"
    >
      <span>You have unsaved changes</span>
      <div>
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button loading={saving} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeNavigate = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (
        !link ||
        link.origin !== window.location.origin ||
        link.pathname === window.location.pathname
      )
        return;
      if (
        !window.confirm(
          'You have unsaved changes. Leave this page and discard them?',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeNavigate, true);
    };
  }, [dirty]);
  return null;
}

export function mapApiValidationErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details))
    return false;
  let mapped = false;
  for (const detail of error.details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const item = detail as { path?: unknown; message?: unknown };
    const path = Array.isArray(item.path) ? item.path.join('.') : item.path;
    if (typeof path !== 'string' || typeof item.message !== 'string') continue;
    setError(path as never, { type: 'server', message: item.message });
    mapped = true;
  }
  return mapped;
}

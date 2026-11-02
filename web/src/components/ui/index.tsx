'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type RefObject,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, CircleAlert, Info, LoaderCircle, X } from 'lucide-react';
import { clsx } from 'clsx';
import { formatMoney } from '@/lib/utils/formatMoney';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  type = 'button',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'button',
        `button--${variant}`,
        `button--${size}`,
        className,
      )}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner label="Loading" /> : null}
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
}

export const Input = forwardRef<
  HTMLInputElement,
  FieldProps & InputHTMLAttributes<HTMLInputElement>
>(function Input({ label, error, hint, id, className, ...props }, ref) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="field">
      <Label htmlFor={fieldId}>{label}</Label>
      <input
        ref={ref}
        id={fieldId}
        className={clsx('input', className)}
        aria-invalid={Boolean(error)}
        aria-describedby={fieldDescriptionIds(fieldId, error, hint)}
        {...props}
      />
      {hint ? (
        <p className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${fieldId}-error`}>{error}</FieldError> : null}
    </div>
  );
});

export function Textarea({
  label,
  error,
  hint,
  id,
  className,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="field">
      <Label htmlFor={fieldId}>{label}</Label>
      <textarea
        id={fieldId}
        className={clsx('textarea', className)}
        aria-invalid={Boolean(error)}
        aria-describedby={fieldDescriptionIds(fieldId, error, hint)}
        {...props}
      />
      {hint ? (
        <p className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${fieldId}-error`}>{error}</FieldError> : null}
    </div>
  );
}

export function Select({
  label,
  error,
  hint,
  id,
  className,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="field">
      <Label htmlFor={fieldId}>{label}</Label>
      <select
        id={fieldId}
        className={clsx('input', className)}
        aria-invalid={Boolean(error)}
        aria-describedby={fieldDescriptionIds(fieldId, error, hint)}
        {...props}
      >
        {children}
      </select>
      {hint ? (
        <p className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${fieldId}-error`}>{error}</FieldError> : null}
    </div>
  );
}

function fieldDescriptionIds(
  fieldId: string,
  error?: string,
  hint?: string,
): string | undefined {
  const ids = [
    hint ? `${fieldId}-hint` : null,
    error ? `${fieldId}-error` : null,
  ].filter((value): value is string => value !== null);
  return ids.length ? ids.join(' ') : undefined;
}

export function Label({
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className="field-label" {...props}>
      {children}
    </label>
  );
}

export function FieldError({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <p className="field-error" id={id} role="alert">
      {children}
    </p>
  );
}

export function Checkbox({
  label,
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  const generatedId = useId();
  return (
    <label className="checkbox" htmlFor={id ?? generatedId}>
      <input id={id ?? generatedId} type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const success = [
    'paid',
    'approved',
    'complete',
    'completed',
    'ready',
  ].includes(normalized);
  const warning = [
    'pending',
    'pending_payment',
    'processing',
    'in_printing',
  ].includes(normalized);
  const Icon = success ? Check : warning ? Info : CircleAlert;
  return (
    <span
      className={clsx(
        'status-badge',
        success && 'status-badge--success',
        warning && 'status-badge--warning',
      )}
    >
      <Icon aria-hidden="true" size={15} />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={clsx('card', className)}>{children}</section>;
}

export function PriceDisplay({
  amountMinor,
  currency,
  compareAtMinor,
}: {
  amountMinor: number;
  currency: string;
  compareAtMinor?: number;
}) {
  return (
    <span className="price-display">
      <strong>{formatMoney(amountMinor, currency)}</strong>
      {compareAtMinor !== undefined && compareAtMinor > amountMinor ? (
        <s>{formatMoney(compareAtMinor, currency)}</s>
      ) : null}
    </span>
  );
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label = 'Quantity',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  return (
    <div className="quantity-stepper" aria-label={label}>
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumbs">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Accordion({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="accordion">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const initialFocus = initialFocusRef?.current;
    if (initialFocus) {
      initialFocus.focus();
    } else {
      dialogRef.current?.focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (document.activeElement === dialogRef.current) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal__heading">
          <h2>{title}</h2>
          <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
            <X />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Dialog(props: Parameters<typeof Modal>[0]) {
  return <Modal {...props} />;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p>{children}</p>
      <div className="button-row">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </Modal>
  );
}

export interface ToastMessage {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastMessage['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const toast = useCallback(
    (message: string, tone: ToastMessage['tone'] = 'info') => {
      const id = Date.now() + Math.random();
      setMessages((current) => [...current, { id, message, tone }]);
      window.setTimeout(
        () =>
          setMessages((current) => current.filter((item) => item.id !== id)),
        5000,
      );
    },
    [],
  );
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {messages.map((item) => (
          <div
            className={`toast toast--${item.tone}`}
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
          >
            <span>{item.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() =>
                setMessages((current) =>
                  current.filter((message) => message.id !== item.id),
                )
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context.toast;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {page} of {totalPages}
      </span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {children ? <div className="empty-state__content">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert aria-hidden="true" />
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <LoaderCircle className="spinner" aria-label={label} role="status" />;
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="visually-hidden">{children}</span>;
}

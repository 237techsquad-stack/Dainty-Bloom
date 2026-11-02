'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Check, CircleAlert, Clock3, Info } from 'lucide-react';
import {
  Button,
  EmptyState as BaseEmptyState,
  LoadingSkeleton,
  Modal,
} from '@/components/ui';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="admin-page-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? (
        <div className="admin-page-header__actions">{actions}</div>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <span className="admin-stat-card__label">{label}</span>
      <strong className="admin-stat-card__value">{value}</strong>
      {detail ? (
        <span className="admin-stat-card__detail">{detail}</span>
      ) : null}
    </>
  );
  return href ? (
    <Link className="admin-stat-card" href={href}>
      {content}
    </Link>
  ) : (
    <article className="admin-stat-card">{content}</article>
  );
}

export function DataTable({
  columns,
  rows,
  emptyTitle = 'Nothing to show yet',
}: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ id: string; values: Record<string, ReactNode> }>;
  emptyTitle?: string;
}) {
  if (!rows.length) return <BaseEmptyState title={emptyTitle} />;
  return (
    <div className="admin-data-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.label}>
                  {row.values[column.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="admin-filter-bar">{children}</div>;
}

export function AdminStatusBadge({ status }: { status: string }) {
  const value = status.replaceAll('_', ' ');
  const normalized = status.toLowerCase();
  const positive = [
    'paid',
    'ready',
    'completed',
    'approved',
    'active',
    'shipped',
  ].includes(normalized);
  const pending = [
    'pending',
    'pending_payment',
    'pending_proof_approval',
    'in_printing',
    'new',
    'draft',
  ].includes(normalized);
  const Icon = positive ? Check : pending ? Clock3 : CircleAlert;
  return (
    <span
      className={`admin-status-badge${positive ? ' is-positive' : ''}${pending ? ' is-pending' : ''}`}
    >
      <Icon size={14} aria-hidden="true" />
      {value}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  return <AdminStatusBadge status={status} />;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return <AdminStatusBadge status={status} />;
}

export function ArtworkReviewStatusBadge({ status }: { status: string }) {
  return <AdminStatusBadge status={status} />;
}

export function ProductStatusBadge({ status }: { status: string }) {
  return <AdminStatusBadge status={status} />;
}

export function MessageStatusBadge({ status }: { status: string }) {
  return <AdminStatusBadge status={status} />;
}

export function AdminConfirmDialog({
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

export function AdminEmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return <BaseEmptyState title={title}>{children}</BaseEmptyState>;
}

export function AdminSkeleton() {
  return (
    <div
      className="admin-skeleton-grid"
      role="status"
      aria-label="Loading dashboard"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div className="admin-panel admin-skeleton-card" key={index}>
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      ))}
    </div>
  );
}

export function ComingSoonLink({
  children,
  href,
}: {
  children: ReactNode;
  href?: string;
}) {
  return (
    <span
      className="admin-coming-soon"
      aria-label={`${String(children)} coming soon`}
    >
      {href ? (
        <Link
          href={href}
          aria-disabled="true"
          tabIndex={-1}
          onClick={(event) => event.preventDefault()}
          title="Coming soon"
        >
          {children}
        </Link>
      ) : (
        children
      )}
      <Info size={13} aria-hidden="true" />
      <span className="visually-hidden">Coming soon</span>
    </span>
  );
}

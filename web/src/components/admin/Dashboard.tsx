'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/providers/AuthProvider';
import { api, ApiError } from '@/lib/api/client';
import type { AdminDashboard, DashboardRange } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils/formatMoney';
import {
  AdminEmptyState,
  ArtworkReviewStatusBadge,
  AdminSkeleton,
  AdminStatusBadge,
  OrderStatusBadge,
  ProductStatusBadge,
  StatCard,
} from '@/components/admin';
import { Button, ErrorState } from '@/components/ui';

function timezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  const elapsed = date.getTime() - Date.now();
  const days = Math.round(elapsed / 86_400_000);
  if (Math.abs(days) < 1) {
    const hours = Math.round(elapsed / 3_600_000);
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
      hours,
      'hour',
    );
  }
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    days,
    'day',
  );
}

function fullDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function optionSummary(options: unknown[]) {
  return (
    options
      .flatMap((option) => {
        if (typeof option !== 'object' || option === null) return [];
        const record = option as Record<string, unknown>;
        const label = typeof record.label === 'string' ? record.label : '';
        const value = typeof record.value === 'string' ? record.value : '';
        return label || value
          ? [`${label}${label && value ? ': ' : ''}${value}`]
          : [];
      })
      .join(', ') || 'No options selected'
  );
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function OrdersRevenueChart({
  data,
  currency,
}: {
  data: AdminDashboard['dailySeries'];
  currency: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const width = 760;
  const height = 270;
  const left = 48;
  const right = 48;
  const top = 18;
  const bottom = 45;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = Array.isArray(data) ? data : [];
  const maxOrders = Math.max(1, ...points.map((item) => count(item.orders)));
  const maxRevenue = Math.max(
    1,
    ...points.map((item) => count(item.revenueMinor)),
  );
  const step = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(2, Math.min(14, step * 0.54));
  const revenuePoints = points.map((item, index) => ({
    x: left + step * index + step / 2,
    y: top + plotHeight - (count(item.revenueMinor) / maxRevenue) * plotHeight,
    item,
  }));
  const line = revenuePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <section
      className="admin-panel admin-chart-panel"
      aria-labelledby="orders-revenue-title"
    >
      <div className="admin-panel-heading">
        <div>
          <h2 id="orders-revenue-title">Orders and revenue</h2>
          <p>Daily orders and paid revenue in the selected period.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={showTable}
          onClick={() => setShowTable((visible) => !visible)}
        >
          {showTable ? 'Hide data table' : 'Show data table'}
        </Button>
      </div>
      <p className="visually-hidden" id="chart-summary">
        Chart showing daily order counts as lavender bars and revenue as a
        purple line across {points.length} days.
      </p>
      <div className="admin-chart-wrap">
        <svg
          className="admin-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby="orders-revenue-title chart-summary"
        >
          <text x="4" y="15" className="admin-chart-axis-title">
            Orders
          </text>
          <text
            x={width - 4}
            y="15"
            textAnchor="end"
            className="admin-chart-axis-title"
          >
            Revenue
          </text>
          {[0, 0.5, 1].map((fraction) => {
            const y = top + plotHeight * (1 - fraction);
            return (
              <g key={fraction}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  className="admin-chart-gridline"
                />
                <text
                  x={left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="admin-chart-label"
                >
                  {Math.round(maxOrders * fraction)}
                </text>
                <text
                  x={width - right + 8}
                  y={y + 4}
                  className="admin-chart-label"
                >
                  {formatMoney(Math.round(maxRevenue * fraction), currency)}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const x = left + step * index + (step - barWidth) / 2;
            const barHeight = (count(point.orders) / maxOrders) * plotHeight;
            return (
              <g
                key={point.date}
                tabIndex={0}
                role="img"
                aria-label={`${point.date}: ${point.orders} orders and ${formatMoney(point.revenueMinor, currency)} revenue`}
                className="admin-chart-point"
              >
                <title>{`${point.date}: ${point.orders} orders, ${formatMoney(point.revenueMinor, currency)} revenue`}</title>
                <rect
                  x={x}
                  y={top + plotHeight - barHeight}
                  width={barWidth}
                  height={Math.max(0, barHeight)}
                  rx="2"
                  className="admin-chart-bar"
                  aria-label={`${point.date}: ${point.orders} orders`}
                />
                {index % labelEvery === 0 || index === points.length - 1 ? (
                  <text
                    x={left + step * index + step / 2}
                    y={height - 14}
                    textAnchor="middle"
                    className="admin-chart-label"
                  >
                    {new Date(`${point.date}T12:00:00`).toLocaleDateString(
                      'en-GB',
                      { day: 'numeric', month: 'short' },
                    )}
                  </text>
                ) : null}
              </g>
            );
          })}
          {revenuePoints.length > 1 ? (
            <path d={line} className="admin-chart-revenue-line" />
          ) : null}
          {revenuePoints.map((point) => (
            <circle
              key={`revenue-${point.item.date}`}
              cx={point.x}
              cy={point.y}
              r="3"
              className="admin-chart-revenue-point"
              tabIndex={0}
              role="img"
              aria-label={`${point.item.date}: ${formatMoney(point.item.revenueMinor, currency)} revenue`}
            >
              <title>{`${point.item.date}: ${formatMoney(point.item.revenueMinor, currency)} revenue`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="admin-chart-legend">
        <span>
          <i className="legend-orders" /> Orders
        </span>
        <span>
          <i className="legend-revenue" /> Revenue
        </span>
      </div>
      {showTable ? (
        <div className="admin-chart-data-table">
          <table>
            <caption>Daily order and revenue data</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Orders</th>
                <th scope="col">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {points.map((item) => (
                <tr key={`table-${item.date}`}>
                  <td>{item.date}</td>
                  <td>{item.orders}</td>
                  <td>{formatMoney(item.revenueMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function AttentionList({
  dashboard,
  notificationCounts,
}: {
  dashboard: AdminDashboard;
  notificationCounts: Record<string, number>;
}) {
  const attention = [
    {
      label: 'Pending payments',
      count: count(dashboard.pendingPayment),
      tone: 'warning',
    },
    {
      label: 'Artwork awaiting review',
      count: count(dashboard.artworkAwaitingReview),
      tone: 'warning',
    },
    {
      label: 'Pending reviews',
      count: count(
        notificationCounts.pending_review ?? dashboard.pendingReviews,
      ),
      tone: 'warning',
    },
    {
      label: 'Low stock products',
      count: count(notificationCounts.low_stock ?? dashboard.lowStockProducts),
      tone: 'warning',
    },
    {
      label: 'Out of stock products',
      count: count(dashboard.outOfStockProducts),
      tone: 'danger',
    },
  ].filter((item) => item.count > 0);

  return (
    <section className="admin-panel" aria-labelledby="needs-attention-title">
      <div className="admin-panel-heading">
        <div>
          <h2 id="needs-attention-title">Needs attention</h2>
          <p>Current items that may need a follow-up.</p>
        </div>
      </div>
      {attention.length ? (
        <ul className="admin-attention-list">
          {attention.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <span className={`admin-attention-count is-${item.tone}`}>
                <strong>{item.count}</strong>
                <span>
                  {item.tone === 'danger' ? 'Out of stock' : 'Needs review'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <AdminEmptyState title="All caught up" />
      )}
    </section>
  );
}

export function Dashboard() {
  const [range, setRange] = useState<DashboardRange>('30d');
  const { user } = useAuth();
  const zone = timezone();
  const dashboard = useQuery({
    queryKey: ['admin-dashboard', range, zone],
    queryFn: () => api.adminDashboard(range, zone),
    retry: false,
  });
  const notifications = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: api.adminNotifications,
    refetchInterval: 60_000,
    retry: false,
  });

  if (dashboard.isPending) return <AdminSkeleton />;
  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="admin-dashboard-error">
        <ErrorState title="Dashboard could not be loaded">
          {dashboard.error instanceof ApiError
            ? dashboard.error.message
            : 'The dashboard data is unavailable right now.'}
        </ErrorState>
        <Button variant="secondary" onClick={() => void dashboard.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const data = dashboard.data;
  const firstName = user?.name.trim().split(/\s+/)[0] || 'there';
  const updatedAt = dashboard.dataUpdatedAt
    ? new Date(dashboard.dataUpdatedAt)
    : new Date();
  const comparison = data.revenueInRange.comparisonPercent;
  const reviewCount = count(
    notifications.data?.counts?.pending_review ?? data.pendingReviews,
  );

  return (
    <div className="admin-dashboard">
      <div className="admin-greeting-row">
        <div>
          <h2>Welcome back, {firstName}</h2>
          <p>Last updated {fullDate(updatedAt.toISOString())}</p>
        </div>
        <div className="admin-dashboard-controls">
          <label>
            <span className="visually-hidden">Dashboard date range</span>
            <select
              value={range}
              onChange={(event) =>
                setRange(event.target.value as DashboardRange)
              }
            >
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            loading={dashboard.isFetching}
            onClick={() =>
              void Promise.all([dashboard.refetch(), notifications.refetch()])
            }
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      <div className="admin-stats-grid">
        <StatCard
          label="Revenue"
          value={formatMoney(data.revenueInRange.revenueMinor, data.currency)}
          detail={
            comparison === null ? (
              'No earlier data'
            ) : (
              <span
                className={`admin-comparison${comparison < 0 ? ' is-down' : ''}`}
              >
                {comparison >= 0 ? '↑' : '↓'} {Math.abs(comparison)}% vs
                previous period
              </span>
            )
          }
        />
        <StatCard
          label="New orders"
          value={count(data.newOrdersInRange)}
          detail={`Last ${range}`}
        />
        <StatCard
          label="Awaiting artwork review"
          value={count(data.artworkAwaitingReview)}
        />
        <StatCard label="In printing" value={count(data.jobsInPrinting)} />
        <StatCard label="Ready to ship" value={count(data.jobsReady)} />
        <StatCard label="Unread messages" value={count(data.unreadMessages)} />
      </div>

      <div className="admin-dashboard-grid admin-dashboard-grid--chart">
        <OrdersRevenueChart
          data={Array.isArray(data.dailySeries) ? data.dailySeries : []}
          currency={data.currency}
        />
        <AttentionList
          dashboard={data}
          notificationCounts={notifications.data?.counts ?? {}}
        />
      </div>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>Recent orders</h2>
          </div>
          {Array.isArray(data.recentOrders) && data.recentOrders.length ? (
            <div className="admin-dashboard-list">
              {data.recentOrders.slice(0, 5).map((order) => (
                <div
                  className="admin-dashboard-list-row"
                  key={order.orderNumber}
                >
                  <span>
                    <strong>{order.orderNumber}</strong>
                    <small>{relativeDate(order.createdAt)}</small>
                  </span>
                  <OrderStatusBadge status={order.status} />
                  <strong>
                    {formatMoney(order.totalMinor, order.currency)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmptyState title="No orders yet" />
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>Print queue</h2>
          </div>
          {Array.isArray(data.printQueue) && data.printQueue.length ? (
            <div className="admin-dashboard-list">
              {data.printQueue.slice(0, 5).map((item, index) => (
                <div
                  className="admin-dashboard-list-row admin-print-row"
                  key={`${item.orderNumber}-${index}`}
                >
                  <span>
                    <strong>
                      {item.orderNumber} · {item.productTitle}
                    </strong>
                    <small>
                      {optionSummary(
                        Array.isArray(item.selectedOptions)
                          ? item.selectedOptions
                          : [],
                      )}{' '}
                      · Qty {item.quantity}
                    </small>
                  </span>
                  <div className="admin-print-badges">
                    <AdminStatusBadge status={item.itemPrintStatus} />
                    {item.artworkReviewStatus ? (
                      <ArtworkReviewStatusBadge
                        status={item.artworkReviewStatus}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmptyState title="No orders in the print queue" />
          )}
        </section>
      </div>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>Top products</h2>
          </div>
          {Array.isArray(data.topProducts) && data.topProducts.length ? (
            <div className="admin-dashboard-list">
              {data.topProducts.slice(0, 5).map((product) => (
                <div
                  className="admin-dashboard-list-row"
                  key={product.productId}
                >
                  <strong>{product.title}</strong>
                  <span>{product.unitsSold} units sold</span>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmptyState title="No product sales yet" />
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>Stock alerts</h2>
          </div>
          {count(data.lowStockProducts) || count(data.outOfStockProducts) ? (
            <div className="admin-stock-alerts">
              {count(data.lowStockProducts) ? (
                <div>
                  <ProductStatusBadge status="low_stock" />
                  <strong>{data.lowStockProducts}</strong>
                  <span>Low stock</span>
                </div>
              ) : null}
              {count(data.outOfStockProducts) ? (
                <div>
                  <ProductStatusBadge status="out_of_stock" />
                  <strong>{data.outOfStockProducts}</strong>
                  <span>Out of stock</span>
                </div>
              ) : null}
            </div>
          ) : (
            <AdminEmptyState title="No stock alerts" />
          )}
        </section>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {notifications.isError
          ? 'Notifications could not be updated.'
          : `${reviewCount} pending reviews.`}
      </p>
    </div>
  );
}

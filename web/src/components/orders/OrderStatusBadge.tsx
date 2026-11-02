import { createElement } from 'react';
import { orderStatusIcon, orderStatusLabel, orderStatusTone } from './orderStatus';

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span className={`order-status-badge order-status-badge--${orderStatusTone(status)}`}>
      {createElement(orderStatusIcon(status), { 'aria-hidden': true, size: 16 })}
      {orderStatusLabel(status)}
    </span>
  );
}

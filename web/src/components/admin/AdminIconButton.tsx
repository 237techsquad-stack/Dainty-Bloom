'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from '@/components/ui';

type AdminIconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children' | 'title'
> & {
  label: string;
  children: ReactNode;
  danger?: boolean;
};

export function AdminIconButton({
  label,
  children,
  danger = false,
  className,
  onClick,
  ...props
}: AdminIconButtonProps) {
  return (
    <Button
      {...props}
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      className={`admin-icon-button${danger ? ' admin-icon-button--danger' : ''}${className ? ` ${className}` : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {children}
    </Button>
  );
}

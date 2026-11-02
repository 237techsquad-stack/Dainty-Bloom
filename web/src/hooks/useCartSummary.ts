'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export function useCartSummary() {
  return useQuery({
    queryKey: ['cart-summary'],
    queryFn: api.cartSummary,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

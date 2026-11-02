'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

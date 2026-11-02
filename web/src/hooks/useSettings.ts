'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { SiteSettings } from '@/lib/api/types';

export function useSettings(initialData?: SiteSettings | null) {
  return useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    ...(initialData ? { initialData } : {}),
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

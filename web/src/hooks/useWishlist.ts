'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { CatalogCard, WishlistResponse } from '@/lib/api/types';

export const wishlistQueryKey = ['wishlist'] as const;

export function useWishlist() {
  const queryClient = useQueryClient();
  const wishlist = useQuery({
    queryKey: wishlistQueryKey,
    queryFn: api.wishlist,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async ({
      product,
      saved,
    }: {
      product: CatalogCard;
      saved: boolean;
    }) =>
      saved
        ? api.removeWishlistItem(product.id)
        : api.addWishlistItem(product.id),
    onMutate: async ({ product, saved }) => {
      await queryClient.cancelQueries({ queryKey: wishlistQueryKey });
      const previous = queryClient.getQueryData<WishlistResponse>(wishlistQueryKey);
      queryClient.setQueryData<WishlistResponse>(wishlistQueryKey, (current) => {
        const products = current?.products ?? [];
        const next = saved
          ? products.filter((item) => item.id !== product.id)
          : [...products, product];
        return {
          products: next,
          count: next.length,
          removedCount: current?.removedCount ?? 0,
        };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(wishlistQueryKey, context.previous);
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(wishlistQueryKey, result);
      void queryClient.invalidateQueries({ queryKey: ['cart-summary'] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: wishlistQueryKey });
    },
  });

  return {
    ...wishlist,
    toggle: (product: CatalogCard) => {
      const saved = wishlist.data?.products.some((item) => item.id === product.id) ?? false;
      mutation.mutate({ product, saved });
    },
    isSaved: (id: string) => wishlist.data?.products.some((product) => product.id === id) ?? false,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

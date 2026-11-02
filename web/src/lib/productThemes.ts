import type { ProductTheme } from './api/types';

export const PRODUCT_THEMES: Array<{
  slug: ProductTheme;
  name: string;
  description: string;
}> = [
  {
    slug: 'christmas',
    name: 'Christmas',
    description: 'Thoughtful festive finds for gifting and gathering.',
  },
  {
    slug: 'halloween',
    name: 'Halloween',
    description: 'Playful and atmospheric pieces for the spooky season.',
  },
  {
    slug: 'autumn',
    name: 'Autumn / Fall',
    description: 'Warm, cosy designs inspired by the changing season.',
  },
  {
    slug: 'kids',
    name: 'Kids',
    description: 'Colourful, joyful finds for little ones and the young at heart.',
  },
  {
    slug: 'anime',
    name: 'Anime',
    description: 'Creative finds inspired by anime and its vibrant worlds.',
  },
];

export function getProductTheme(slug: string) {
  return PRODUCT_THEMES.find((theme) => theme.slug === slug);
}

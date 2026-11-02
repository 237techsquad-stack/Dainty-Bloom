'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AdminConfirmDialog,
  AdminStatusBadge,
  PageHeader,
} from '@/components/admin';
import {
  CharacterCounter,
  ImageDropzone,
  mapApiValidationErrors,
  MoneyInput,
  MultiSelect,
  Repeater,
  SearchableSelect,
  StickySaveBar,
  Switch,
  UnsavedChangesGuard,
} from '@/components/admin/ManagementFields';
import {
  OPTION_LABELS,
  PRINT_TECHNIQUES,
  PRODUCT_TYPE_OPTION_KEYS,
  PRODUCT_TYPE_OPTIONS,
} from '@/components/admin/productOptionConfig';
import {
  Button,
  Checkbox,
  ErrorState,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import {
  api,
  ApiError,
  uploadAdminProductImage,
  type ProductWriteInput,
} from '@/lib/api/client';
import type {
  AdminProduct,
  CategoryFormProfile,
  ProductMedia,
  ProductStatus,
  ProductTheme,
} from '@/lib/api/types';
import { usePermissions } from '@/components/providers/AuthProvider';
import { useSettings } from '@/hooks/useSettings';

const mediaSchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  url: z.string().url(),
  publicId: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  alt: z.string().max(200),
  view: z.enum([
    'front',
    'back',
    'detail',
    'size_reference',
    'sample',
    'side',
    'lifestyle',
  ]),
  lightingState: z.enum(['on', 'off']).optional(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int(),
  variants: z
    .object({ thumb: z.string(), medium: z.string(), large: z.string() })
    .optional(),
});

const productThemes = [
  { value: 'christmas', label: 'Christmas' },
  { value: 'halloween', label: 'Halloween' },
  { value: 'autumn', label: 'Autumn / Fall' },
  { value: 'kids', label: 'Kids' },
  { value: 'anime', label: 'Anime' },
] as const satisfies readonly { value: ProductTheme; label: string }[];

const productFormSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.string().trim().min(1).max(220),
    description: z.string().trim().min(20).max(5000),
    category: z.string().regex(/^[a-f\d]{24}$/i, 'Choose an active category'),
    productType: z.enum([
      'tshirt',
      'mug',
      'canvas_paint_yourself',
      'canvas_custom_print',
      'three_d_printed',
      'other',
    ]),
    themes: z.array(
      z.enum(['christmas', 'halloween', 'autumn', 'kids', 'anime']),
    ),
    media: z.array(mediaSchema).max(30),
    lightingGalleryEnabled: z.boolean(),
    sku: z.string().trim().min(1).max(80),
    basePriceMinor: z.number().int().nonnegative(),
    compareAtPriceMinor: z.number().int().nonnegative().optional(),
    currency: z
      .string()
      .length(3)
      .refine((value): boolean => value === 'GBP', {
        message: 'New and active products must use GBP.',
      }),
    optionGroups: z
      .array(
        z
          .object({
            key: z.string().min(1),
            label: z.string().trim().min(1).max(100),
            required: z.boolean(),
            values: z
              .array(
                z
                  .object({
                    label: z.string().trim().min(1).max(120),
                    value: z.string().trim().min(1).max(120),
                    priceModifierMinor: z.number().int(),
                    hex: z
                      .string()
                      .regex(/^#[0-9a-f]{6}$/i)
                      .optional()
                      .or(z.literal('')),
                    skuSuffix: z.string().max(32).optional(),
                    isAvailable: z.boolean(),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(10),
    quantityPricing: z.array(
      z.object({
        minQty: z.number().int().positive(),
        unitPriceMinor: z.number().int().nonnegative(),
      }),
    ),
    printTechniques: z.array(z.string().min(1)).max(10),
    specifications: z
      .array(
        z.object({
          label: z.string().trim().min(1),
          value: z.string().trim().min(1),
        }),
      )
      .max(100),
    artworkRequirements: z.object({
      allowedFormats: z.array(z.string().trim().min(1).max(20)).max(30),
      minimumResolutionNote: z.string().max(500).optional(),
      notes: z.string().max(2000).optional(),
    }),
    artworkRequired: z.boolean(),
    stock: z.object({
      trackInventory: z.boolean(),
      quantity: z.number().int().nonnegative(),
      lowStockThreshold: z.number().int().nonnegative(),
      allowBackorder: z.boolean(),
      reserveBlanksForMadeToOrder: z.boolean(),
    }),
    status: z.enum(['draft', 'active', 'archived', 'out_of_stock']),
    seo: z.object({
      metaTitle: z.string().max(200).optional(),
      metaDescription: z.string().max(500).optional(),
      canonicalUrl: z.union([z.string().url(), z.literal('')]).optional(),
    }),
    leadTimeDays: z.number().int().nonnegative().optional(),
    madeToOrder: z.boolean(),
    ecoNote: z
      .string()
      .max(300)
      .refine((value) => !/<\/?[a-z][^>]*>/i.test(value))
      .optional(),
    isFeatured: z.boolean(),
    minOrderQuantity: z.number().int().positive(),
    maxOrderQuantity: z.number().int().positive().optional(),
  })
  .superRefine((values, context) => {
    if (
      values.compareAtPriceMinor !== undefined &&
      values.compareAtPriceMinor <= values.basePriceMinor
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compareAtPriceMinor'],
        message: 'Compare-at price must be greater than the base price.',
      });
    }
    if (
      values.quantityPricing.some(
        (tier, index) =>
          index > 0 && tier.minQty <= values.quantityPricing[index - 1].minQty,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['quantityPricing'],
        message:
          'Quantity tiers must have strictly ascending minimum quantities.',
      });
    }
    if (
      values.maxOrderQuantity !== undefined &&
      values.maxOrderQuantity < values.minOrderQuantity
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maxOrderQuantity'],
        message: 'Maximum quantity must be at least the minimum quantity.',
      });
    }
  });

type ProductFormValues = z.infer<typeof productFormSchema>;

const PROFILE_OPTION_KEYS: Record<
  Exclude<CategoryFormProfile, 'general'>,
  readonly string[]
> = {
  apparel: ['material', 'colour', 'color', 'size', 'printArea'],
  drinkware: ['capacity', 'size', 'colour', 'color', 'printArea'],
  canvas_art: ['size', 'frame', 'edgeStyle', 'finish'],
  three_d_printed: ['material', 'colour', 'color', 'size', 'finish'],
  bags: ['material', 'technique', 'color', 'colour', 'size', 'printArea'],
};

const PROFILES_WITH_PRINT_TECHNIQUES: readonly CategoryFormProfile[] = [
  'apparel',
  'drinkware',
  'canvas_art',
  'bags',
  'general',
];

function emptyProduct(currency: string): ProductFormValues {
  return {
    title: '',
    slug: '',
    description: '',
    category: '',
    productType: 'tshirt',
    themes: [],
    media: [],
    lightingGalleryEnabled: false,
    sku: '',
    basePriceMinor: 0,
    compareAtPriceMinor: undefined,
    currency,
    optionGroups: [],
    quantityPricing: [],
    printTechniques: [],
    specifications: [],
    artworkRequirements: {
      allowedFormats: [],
      minimumResolutionNote: '',
      notes: '',
    },
    artworkRequired: false,
    stock: {
      trackInventory: false,
      quantity: 0,
      lowStockThreshold: 0,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
    status: 'draft',
    seo: { metaTitle: '', metaDescription: '', canonicalUrl: '' },
    leadTimeDays: undefined,
    madeToOrder: false,
    ecoNote: '',
    isFeatured: false,
    minOrderQuantity: 1,
    maxOrderQuantity: undefined,
  };
}

interface CategoryOptionNode {
  _id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  formProfile?: CategoryFormProfile;
  children: CategoryOptionNode[];
}

function flattenCategories(
  categories: CategoryOptionNode[],
  depth = 0,
  parentPath = '',
  ancestorsActive = true,
): Array<{
  value: string;
  label: string;
  slug: string;
  depth: number;
  isActive: boolean;
  formProfile: CategoryFormProfile;
}> {
  return categories.flatMap((category) => [
    {
      value: category._id,
      label: parentPath ? `${parentPath} / ${category.name}` : category.name,
      slug: category.slug,
      depth,
      isActive: ancestorsActive && (category.isActive ?? false),
      formProfile: category.formProfile ?? 'general',
    },
    ...flattenCategories(
      category.children,
      depth + 1,
      parentPath ? `${parentPath} / ${category.name}` : category.name,
      ancestorsActive && (category.isActive ?? false),
    ),
  ]);
}

function mediaId(media: ProductMedia) {
  return media.id ?? media._id;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function omitMedia(input: ProductWriteInput): Omit<ProductWriteInput, 'media'> {
  const { media: _media, ...product } = input;
  void _media;
  return product;
}

interface PendingUpload {
  key: string;
  file: File;
  preview: string;
  alt: string;
  view: ProductMedia['view'];
  lightingState?: ProductMedia['lightingState'];
  isPrimary: boolean;
  progress: number;
  error?: string;
  errorStatus?: number;
  errorOperation?: 'gallery-save' | 'image-upload';
  uploading: boolean;
  queued: boolean;
}

function pendingUploadErrorOperationLabel(
  operation: PendingUpload['errorOperation'],
): string | undefined {
  if (operation === 'gallery-save')
    return 'Saving the Light ON/OFF gallery setting (product PATCH) failed.';
  if (operation === 'image-upload')
    return 'Uploading the image (media POST) failed.';
  return undefined;
}

const PRODUCT_MEDIA_MAX_IMAGES = 10;
const PRODUCT_MEDIA_VIEWS = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'detail', label: 'Detail' },
  { value: 'size_reference', label: 'Size Reference' },
  { value: 'sample', label: 'Sample' },
  { value: 'side', label: 'Side' },
  { value: 'lifestyle', label: 'Lifestyle' },
] as const satisfies readonly {
  value: ProductMedia['view'];
  label: string;
}[];

type ProductEditorSection =
  | 'details'
  | 'pricing'
  | 'options'
  | 'production'
  | 'inventory'
  | 'images'
  | 'search';

const sectionByField: Partial<
  Record<keyof ProductFormValues, ProductEditorSection>
> = {
  title: 'details',
  slug: 'details',
  description: 'details',
  category: 'details',
  productType: 'details',
  themes: 'details',
  basePriceMinor: 'pricing',
  compareAtPriceMinor: 'pricing',
  quantityPricing: 'pricing',
  minOrderQuantity: 'pricing',
  maxOrderQuantity: 'pricing',
  optionGroups: 'options',
  printTechniques: 'production',
  specifications: 'production',
  artworkRequirements: 'production',
  artworkRequired: 'production',
  madeToOrder: 'production',
  leadTimeDays: 'production',
  ecoNote: 'production',
  sku: 'inventory',
  stock: 'inventory',
  media: 'images',
  seo: 'search',
};

export function ProductEditor({ productId }: { productId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can('products:write');
  const settings = useSettings();
  const [createdProduct, setCreatedProduct] = useState<AdminProduct | null>(
    null,
  );
  const activeProductId = createdProduct?._id ?? productId;
  const isNew = !activeProductId;
  const productQuery = useQuery({
    queryKey: ['admin-product', productId],
    queryFn: () => api.adminProduct(productId!),
    enabled: Boolean(productId),
    retry: false,
  });
  const categories = useQuery({
    queryKey: canWrite ? ['admin-categories'] : ['categories'],
    queryFn: canWrite ? api.adminCategories : api.categories,
    retry: false,
    enabled: can('products:read'),
  });
  const savedProduct = createdProduct ?? productQuery.data ?? undefined;
  const serverGalleryEnabled = Boolean(
    savedProduct &&
    savedProduct._id === activeProductId &&
    savedProduct.lightingGalleryEnabled === true,
  );
  const currency = savedProduct?.currency ?? 'GBP';
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: emptyProduct(currency),
    mode: 'onSubmit',
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    resetField,
    getValues,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isDirty, isSubmitting },
  } = form;
  const formWatch = useWatch({ control });
  void formWatch;
  const values = form.getValues();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const pendingRef = useRef<PendingUpload[]>([]);
  const uploadInFlightRef = useRef(new Set<string>());
  const queuedUploadKeysRef = useRef(new Set<string>());
  const uploadQueueRef = useRef(Promise.resolve());
  const draftCreationPromiseRef = useRef<Promise<AdminProduct | null> | null>(
    null,
  );
  const activeProductIdRef = useRef(productId);
  const assignmentInFlightRef = useRef(new Set<string>());
  const saveInFlightRef = useRef(false);
  const [serverError, setServerError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [mediaConflictMessage, setMediaConflictMessage] = useState('');
  const [mediaConflictBusy, setMediaConflictBusy] = useState(false);
  const [assignmentBusyIds, setAssignmentBusyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const mediaMutationEpoch = useRef(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mediaDeleteTarget, setMediaDeleteTarget] =
    useState<ProductMedia | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const formElementRef = useRef<HTMLFormElement>(null);
  const imagesHashHandled = useRef(false);
  const initialCategoryHandled = useRef(false);
  const hydratedProductId = useRef<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<ProductEditorSection>>(
    () => new Set(['details']),
  );

  function updatePending(
    update: (current: PendingUpload[]) => PendingUpload[],
  ) {
    const next = update(pendingRef.current);
    pendingRef.current = next;
    setPending(next);
  }

  useEffect(
    () => () => {
      pendingRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
    },
    [],
  );

  function markMediaMutation() {
    mediaMutationEpoch.current += 1;
  }

  async function refreshMediaAfterConflict(
    operation?: string,
    ownerProductId = activeProductId,
  ): Promise<boolean> {
    if (!ownerProductId) return false;
    setMediaConflictBusy(true);
    const operationMessage = operation
      ? `Another request changed the product images while ${operation}.`
      : 'Refreshing product images from the server.';
    setMediaConflictMessage(`${operationMessage} Refreshing the latest state…`);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const epoch = mediaMutationEpoch.current;
        const refreshed = await api.adminProduct(ownerProductId);
        if (epoch !== mediaMutationEpoch.current) continue;
        resetField('media', {
          defaultValue: refreshed.media ?? [],
        });
        setCreatedProduct((current) => (current ? refreshed : current));
        queryClient.setQueryData(['admin-product', refreshed._id], refreshed);
        setMediaConflictMessage(
          operation
            ? `${operationMessage} The latest server images are shown. The action was not retried; review the gallery and repeat it manually if needed. Any unsaved image-detail edits may need to be re-entered.`
            : 'The latest server images are shown. Review the gallery before continuing.',
        );
        return true;
      }
      setMediaConflictMessage(
        `${operationMessage} Another media change was still in progress. Use “Refresh media” before making another image change.`,
      );
      return false;
    } catch (error) {
      setMediaConflictMessage(
        `${operationMessage} The latest images could not be loaded${error instanceof ApiError ? `: ${error.message}` : '.'} Use “Refresh media” before making another image change.`,
      );
      return false;
    } finally {
      setMediaConflictBusy(false);
    }
  }

  useEffect(() => {
    const fetchedProduct = productQuery.data;
    if (!productId || !fetchedProduct) return;
    if (hydratedProductId.current !== fetchedProduct._id) {
      reset(toFormValues(fetchedProduct));
      hydratedProductId.current = fetchedProduct._id;
      updatePending((current) => {
        current.forEach((image) => URL.revokeObjectURL(image.preview));
        return [];
      });
      return;
    }
    if (!form.getFieldState('media').isDirty) {
      setValue('media', fetchedProduct.media ?? [], { shouldDirty: false });
    }
  }, [form, productId, productQuery.data, reset, setValue]);

  useEffect(() => {
    if (
      !isNew ||
      categories.isPending ||
      categories.isError ||
      initialCategoryHandled.current
    )
      return;

    initialCategoryHandled.current = true;
    const initialCategoryId = new URLSearchParams(window.location.search).get(
      'category',
    );
    if (!initialCategoryId) return;

    const category = flattenCategories(categories.data ?? []).find(
      (item) => item.value === initialCategoryId && item.isActive,
    );
    if (!category) {
      setError('category', {
        type: 'validate',
        message:
          'The selected category is no longer available. Choose an active category before saving.',
      });
      return;
    }

    clearErrors('category');
    setValue('category', category.value, { shouldDirty: false });
  }, [
    categories.data,
    categories.isError,
    categories.isPending,
    isNew,
    setValue,
    setError,
    clearErrors,
  ]);

  useEffect(() => {
    if (window.location.hash !== '#images') return;
    const frame = window.requestAnimationFrame(() =>
      setOpenSections((current) => new Set(current).add('images')),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (
      window.location.hash !== '#images' ||
      !openSections.has('images') ||
      imagesHashHandled.current
    )
      return;
    imagesHashHandled.current = true;
    window.requestAnimationFrame(() =>
      document
        .getElementById('images')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [openSections]);

  useEffect(() => {
    if (isNew && currency && !isDirty) {
      setValue('currency', currency);
    }
  }, [currency, isNew, isDirty, setValue]);

  const flatCategories = useMemo(
    () => flattenCategories(categories.data ?? []),
    [categories.data],
  );
  const allowedOptionKeys = PRODUCT_TYPE_OPTION_KEYS[
    values.productType ?? 'tshirt'
  ] as readonly string[];
  const optionGroups = values.optionGroups ?? [];
  const media = Array.isArray(values.media) ? values.media : [];
  const productType = values.productType ?? 'tshirt';
  const paintCanvas = productType === 'canvas_paint_yourself';
  const selectedCategory = flatCategories.find(
    (category) => category.value === values.category,
  );
  const lightingGalleryEligible =
    selectedCategory?.slug === 'lamps-and-lighting';
  const showLightingGallerySetting =
    lightingGalleryEligible || values.lightingGalleryEnabled;
  const selectedCategoryProfile = selectedCategory?.formProfile ?? 'general';
  const formProfile = isNew ? selectedCategoryProfile : 'general';
  const profileAllowedOptionKeys =
    formProfile === 'general'
      ? allowedOptionKeys
      : allowedOptionKeys.filter((key) =>
          PROFILE_OPTION_KEYS[formProfile].includes(key),
        );
  const visibleOptionGroups =
    isNew && formProfile !== 'general'
      ? optionGroups.filter((group) =>
          PROFILE_OPTION_KEYS[formProfile].includes(group.key),
        )
      : optionGroups;
  const hiddenOptionGroupCount =
    optionGroups.length - visibleOptionGroups.length;
  const showPrintTechniques =
    PROFILES_WITH_PRINT_TECHNIQUES.includes(formProfile) ||
    (values.printTechniques?.length ?? 0) > 0;
  const hasArtworkRequirements =
    Boolean(values.artworkRequired) ||
    Boolean(values.artworkRequirements?.allowedFormats?.length) ||
    Boolean(values.artworkRequirements?.minimumResolutionNote?.trim()) ||
    Boolean(values.artworkRequirements?.notes?.trim());
  const showArtworkControls =
    formProfile !== 'three_d_printed' || hasArtworkRequirements;
  const readyChecks = [
    ['Title entered', Boolean(values.title?.trim())],
    ['Category selected', Boolean(values.category)],
    ['Price above zero', (values.basePriceMinor ?? 0) > 0],
    ['SKU set', Boolean(values.sku?.trim())],
    [
      'Primary image added',
      values.lightingGalleryEnabled
        ? media.length > 0 &&
          media.every((image) => Boolean(image.lightingState)) &&
          (['on', 'off'] as const).every((state) => {
            const stateImages = media.filter(
              (image) => image.lightingState === state,
            );
            return (
              stateImages.length === 0 ||
              stateImages.filter((image) => image.isPrimary).length === 1
            );
          })
        : media.some((image) => image.isPrimary),
    ],
    ['Description present', Boolean(values.description?.trim())],
  ] as const;
  const canActivate = readyChecks.every(([, valid]) => valid);
  const categorySelection = flatCategories.map((category) => ({
    value: category.value,
    label: category.label,
    depth: category.depth,
    isActive: category.isActive,
  }));
  const selectableCategories = categorySelection.filter(
    (category) => !isNew || category.isActive,
  );

  function addOptionGroup(key: string) {
    setValue(
      'optionGroups',
      [
        ...optionGroups,
        { key, label: OPTION_LABELS[key] ?? key, required: false, values: [] },
      ],
      { shouldDirty: true },
    );
  }

  function updateOptionGroup(
    index: number,
    update: Partial<ProductFormValues['optionGroups'][number]>,
  ) {
    const next = [...optionGroups];
    next[index] = { ...next[index], ...update };
    setValue('optionGroups', next, { shouldDirty: true });
  }

  function updateOptionValue(
    groupIndex: number,
    valueIndex: number,
    update: Partial<
      ProductFormValues['optionGroups'][number]['values'][number]
    >,
  ) {
    const groups = [...optionGroups];
    const values = [...groups[groupIndex].values];
    values[valueIndex] = { ...values[valueIndex], ...update };
    groups[groupIndex] = { ...groups[groupIndex], values };
    setValue('optionGroups', groups, { shouldDirty: true });
  }

  function addOptionValue(groupIndex: number) {
    const current = optionGroups[groupIndex];
    updateOptionGroup(groupIndex, {
      values: [
        ...current.values,
        { label: '', value: '', priceModifierMinor: 0, isAvailable: true },
      ],
    });
  }

  function productPayload(
    valuesToSave: ProductFormValues,
    status: ProductStatus,
  ): ProductWriteInput {
    return {
      ...valuesToSave,
      status,
      media: valuesToSave.media.map(
        ({ url, alt, view, isPrimary, lightingState }) => ({
          url,
          alt,
          view,
          isPrimary,
          lightingState,
        }),
      ),
      seo: {
        ...valuesToSave.seo,
        canonicalUrl: valuesToSave.seo.canonicalUrl || undefined,
      },
      compareAtPriceMinor: valuesToSave.compareAtPriceMinor || undefined,
      leadTimeDays: valuesToSave.leadTimeDays || undefined,
      maxOrderQuantity: valuesToSave.maxOrderQuantity || undefined,
      ecoNote: valuesToSave.ecoNote || undefined,
    };
  }

  function validateDraftCategory(categoryId: string): boolean {
    if (categories.isPending || categories.isError) {
      setError('category', {
        type: 'validate',
        message:
          'Categories must finish loading successfully before this draft can be saved.',
      });
      return false;
    }
    if (
      !flatCategories.some(
        (category) => category.value === categoryId && category.isActive,
      )
    ) {
      setError('category', {
        type: 'validate',
        message:
          'Choose an active category whose parent categories are also active.',
      });
      return false;
    }
    return true;
  }

  async function createDraftFromValues(
    valuesToSave: ProductFormValues,
  ): Promise<AdminProduct | null> {
    if (!validateDraftCategory(valuesToSave.category)) return null;
    const product = await api.createAdminProduct(
      productPayload(valuesToSave, 'draft'),
    );
    activeProductIdRef.current = product._id;
    if (window.location.pathname === '/admin/products/new') {
      window.history.replaceState(
        window.history.state,
        '',
        `/admin/products/${product._id}`,
      );
    }
    setCreatedProduct(product);
    queryClient.setQueryData(['admin-product', product._id], product);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['admin-product', product._id],
      }),
      queryClient.invalidateQueries({ queryKey: ['admin-products'] }),
    ]);
    if (JSON.stringify(getValues()) === JSON.stringify(valuesToSave)) {
      reset(toFormValues(product));
    }
    return product;
  }

  async function ensureDraftForUpload(): Promise<{
    id: string;
    lightingGalleryEnabled: boolean;
  } | null> {
    if (activeProductIdRef.current) {
      const currentProduct =
        savedProduct?._id === activeProductIdRef.current
          ? savedProduct
          : undefined;
      return {
        id: activeProductIdRef.current,
        lightingGalleryEnabled: currentProduct?.lightingGalleryEnabled === true,
      };
    }
    if (draftCreationPromiseRef.current) {
      const product = await draftCreationPromiseRef.current;
      return product
        ? {
            id: product._id,
            lightingGalleryEnabled: product.lightingGalleryEnabled === true,
          }
        : null;
    }

    const creation = (async () => {
      try {
        const valid = await form.trigger();
        if (!valid) {
          setSaveNotice(
            'Complete the required product fields before an image can be uploaded. Your selected image is still staged.',
          );
          focusFirstInvalid(form.formState.errors);
          return null;
        }
        const parsed = productFormSchema.safeParse(getValues());
        if (!parsed.success) {
          setSaveNotice(
            'Complete the required product fields before an image can be uploaded. Your selected image is still staged.',
          );
          return null;
        }
        setServerError('');
        setSaveNotice('Creating a draft to attach the selected image…');
        const product = await createDraftFromValues(parsed.data);
        if (!product) {
          setSaveNotice(
            'Choose an active category before an image can be uploaded. Your selected image is still staged.',
          );
          return null;
        }
        toast('Draft created. Uploading selected images.', 'success');
        setSaveNotice('Draft created successfully. Uploading selected images…');
        return product;
      } catch (error) {
        setServerError(
          error instanceof ApiError
            ? `Draft could not be created: ${error.message}${error.status > 0 ? ` (HTTP ${error.status})` : ''}`
            : 'Draft could not be created. Your selected images remain staged.',
        );
        setSaveNotice('Draft creation failed. Correct the issue and retry.');
        return null;
      }
    })();
    draftCreationPromiseRef.current = creation;
    try {
      const product = await creation;
      return product
        ? {
            id: product._id,
            lightingGalleryEnabled: product.lightingGalleryEnabled === true,
          }
        : null;
    } finally {
      draftCreationPromiseRef.current = null;
    }
  }

  function queuePendingUploads(keys: string[]): Promise<void> {
    const uniqueKeys = [...new Set(keys)].filter((key) => {
      if (
        queuedUploadKeysRef.current.has(key) ||
        uploadInFlightRef.current.has(key)
      ) {
        return false;
      }
      queuedUploadKeysRef.current.add(key);
      return true;
    });
    if (uniqueKeys.length === 0) return uploadQueueRef.current;
    updatePending((current) =>
      current.map((image) =>
        uniqueKeys.includes(image.key)
          ? {
              ...image,
              queued: true,
              error: undefined,
              errorStatus: undefined,
              errorOperation: undefined,
            }
          : image,
      ),
    );

    const run = async () => {
      try {
        const validKeys: string[] = [];
        for (const key of uniqueKeys) {
          const image = pendingRef.current.find((item) => item.key === key);
          if (!image) continue;
          const validationError = await validatePendingImage(image);
          if (!pendingRef.current.some((item) => item.key === key)) continue;
          if (validationError) {
            updatePending((current) =>
              current.map((item) =>
                item.key === key
                  ? {
                      ...item,
                      uploading: false,
                      error: validationError,
                      errorStatus: undefined,
                    }
                  : item,
              ),
            );
            setSaveNotice(
              `${image.file.name} could not be uploaded: ${validationError}`,
            );
          } else {
            validKeys.push(key);
          }
        }
        if (validKeys.length === 0) return;
        const ownerProduct = await ensureDraftForUpload();
        if (!ownerProduct) {
          updatePending((current) =>
            current.map((image) =>
              validKeys.includes(image.key)
                ? {
                    ...image,
                    uploading: false,
                    error:
                      'Complete the required product fields, then save the draft to upload this image.',
                  }
                : image,
            ),
          );
          return;
        }
        const ownerProductId = ownerProduct.id;
        const lightingUploads = validKeys.filter((key) =>
          pendingRef.current.some(
            (image) => image.key === key && image.lightingState !== undefined,
          ),
        );
        if (lightingUploads.length > 0) {
          if (getValues('lightingGalleryEnabled') !== true) {
            updatePending((current) =>
              current.map((image) =>
                lightingUploads.includes(image.key)
                  ? {
                      ...image,
                      uploading: false,
                      error:
                        'Enable and save the Light ON/OFF gallery before uploading this image.',
                      errorStatus: undefined,
                    }
                  : image,
              ),
            );
            setSaveNotice(
              'Lighting images remain pending until the gallery setting is enabled and saved.',
            );
            return;
          }
          if (!ownerProduct.lightingGalleryEnabled) {
            try {
              setSaveNotice(
                'Saving the Light ON/OFF gallery setting before uploading…',
              );
              const updatedProduct = await api.updateAdminProduct(
                ownerProductId,
                { lightingGalleryEnabled: true },
              );
              if (updatedProduct._id !== ownerProductId) {
                throw new Error(
                  'The saved product did not match the selected product.',
                );
              }
              activeProductIdRef.current = updatedProduct._id;
              setCreatedProduct(updatedProduct);
              queryClient.setQueryData(
                ['admin-product', ownerProductId],
                updatedProduct,
              );
            } catch (error) {
              const message =
                error instanceof ApiError
                  ? error.message
                  : 'The Light ON/OFF gallery setting could not be saved.';
              const status =
                error instanceof ApiError && error.status > 0
                  ? ` (HTTP ${error.status})`
                  : '';
              setServerError(
                `Image upload was not started: ${message}${status}`,
              );
              setSaveNotice(
                'The gallery setting could not be saved. Selected images remain pending.',
              );
              updatePending((current) =>
                current.map((image) =>
                  lightingUploads.includes(image.key)
                    ? {
                        ...image,
                        uploading: false,
                        error: message,
                        errorStatus:
                          error instanceof ApiError ? error.status : undefined,
                        errorOperation: 'gallery-save',
                      }
                    : image,
                ),
              );
              return;
            }
          }
        }
        for (const key of validKeys) {
          const image = pendingRef.current.find((item) => item.key === key);
          if (image) await uploadImage(image, ownerProductId);
        }
      } finally {
        uniqueKeys.forEach((key) => queuedUploadKeysRef.current.delete(key));
        updatePending((current) =>
          current.map((image) =>
            uniqueKeys.includes(image.key)
              ? { ...image, queued: false }
              : image,
          ),
        );
      }
    };
    uploadQueueRef.current = uploadQueueRef.current.then(run, run);
    return uploadQueueRef.current;
  }

  async function validatePendingImage(
    image: PendingUpload,
  ): Promise<string | undefined> {
    if ((getValues('media') ?? []).length >= PRODUCT_MEDIA_MAX_IMAGES) {
      return `The product has reached the ${PRODUCT_MEDIA_MAX_IMAGES}-image limit. Remove a saved image before uploading this file.`;
    }
    if (image.file.size > 10 * 1024 * 1024) {
      return 'Image exceeds the 10 MB upload limit.';
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.file.type)) {
      return 'Choose a JPEG, PNG or WebP image.';
    }
    if (image.alt.trim().length < 3 || image.alt.trim().length > 200) {
      return 'Alt text must be 3–200 characters.';
    }
    try {
      const dimensions = await imageDimensions(image.preview);
      if (Math.min(dimensions.width, dimensions.height) < 600) {
        return 'Image must be at least 600 pixels on its shortest side.';
      }
    } catch {
      return 'This image file could not be read.';
    }
    return undefined;
  }

  async function save(valuesToSave: ProductFormValues) {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setServerError('');
    setSaveNotice('');
    try {
      await uploadQueueRef.current;
      let productIdToSave = activeProductIdRef.current;
      let product: AdminProduct | null = null;
      let createdDuringSave = false;
      if (!productIdToSave) {
        product = await createDraftFromValues(valuesToSave);
        if (!product) return;
        productIdToSave = product._id;
        createdDuringSave = true;
      } else if (isDirty) {
        product = await api.updateAdminProduct(
          productIdToSave,
          omitMedia(productPayload(valuesToSave, valuesToSave.status)),
        );
        setCreatedProduct(product);
        queryClient.setQueryData(['admin-product', product._id], product);
        if (JSON.stringify(getValues()) === JSON.stringify(valuesToSave)) {
          reset(toFormValues(product));
        }
      }

      if (!product && productIdToSave) {
        product =
          queryClient.getQueryData<AdminProduct>([
            'admin-product',
            productIdToSave,
          ]) ?? null;
      }
      if (product) {
        queryClient.setQueryData(['admin-product', product._id], product);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['admin-product', product._id],
          }),
          queryClient.invalidateQueries({ queryKey: ['admin-products'] }),
        ]);
      }

      setSaveNotice(
        `Product details saved successfully.${createdDuringSave && pendingRef.current.length ? ` Uploading ${pendingRef.current.length} pending image${pendingRef.current.length === 1 ? '' : 's'}…` : ''}`,
      );
      toast('Product details saved.', 'success');
      if (createdDuringSave) {
        await queuePendingUploads(pendingRef.current.map((image) => image.key));
      }
      const savedImageCount = (getValues('media') ?? []).length;
      const remainingImageCount = pendingRef.current.length;
      if (remainingImageCount > 0) {
        setSaveNotice(
          `Product details saved. ${savedImageCount} image${savedImageCount === 1 ? '' : 's'} saved; ${remainingImageCount} remain pending. Review errors and retry.`,
        );
      } else if (savedImageCount > 0) {
        setSaveNotice(
          `Product details saved. ${savedImageCount} image${savedImageCount === 1 ? '' : 's'} saved.`,
        );
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SKU_ALREADY_EXISTS') {
        setError('sku', {
          type: 'server',
          message: `${error.message}${error.status > 0 ? ` (HTTP ${error.status})` : ''}`,
        });
        setServerError(
          `Product details were not saved: ${error.message}${error.status > 0 ? ` (HTTP ${error.status})` : ''}`,
        );
        formElementRef.current
          ?.querySelector<HTMLInputElement>('[name="sku"]')
          ?.focus();
      } else {
        mapApiValidationErrors(error, setError);
        setServerError(
          error instanceof ApiError
            ? `Product details were not saved: ${error.message}${error.status > 0 ? ` (HTTP ${error.status})` : ''}`
            : 'Product details could not be saved. Please try again.',
        );
        formElementRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus();
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }

  async function setStatus(status: ProductStatus) {
    if (!activeProductId) return;
    setStatusBusy(true);
    try {
      const updated = await api.setAdminProductStatus(activeProductId, status);
      setCreatedProduct((current) => (current ? updated : current));
      await queryClient.invalidateQueries({
        queryKey: ['admin-product', activeProductId],
      });
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast(
        `Product status changed to ${status.replaceAll('_', ' ')}.`,
        'success',
      );
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'Product status could not be changed.',
        'error',
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function deleteProduct() {
    if (!activeProductId || pendingRef.current.length > 0) return;
    try {
      const result = await api.deleteAdminProduct(activeProductId);
      toast(result.message, 'success');
      router.replace('/admin/products');
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'Product could not be deleted.',
        'error',
      );
    } finally {
      setDeleteOpen(false);
    }
  }

  function addFiles(
    files: File[],
    lightingState?: ProductMedia['lightingState'],
  ) {
    const savedMedia = getValues('media') ?? [];
    const currentPending = pendingRef.current;
    const remaining = Math.max(
      0,
      PRODUCT_MEDIA_MAX_IMAGES - savedMedia.length - currentPending.length,
    );
    const accepted = files.slice(0, remaining);
    const title = getValues('title').trim();
    const rows = accepted.map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      preview: URL.createObjectURL(file),
      alt: `${title ? `${title} - ` : ''}${
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim() || 'Product image'
      }`.slice(0, 200),
      view: 'front' as const,
      lightingState,
      isPrimary: lightingState
        ? !savedMedia.some(
            (image) => image.lightingState === lightingState && image.isPrimary,
          ) &&
          !currentPending.some(
            (image) => image.lightingState === lightingState && image.isPrimary,
          ) &&
          !currentPending.some((image) => image.lightingState === lightingState)
        : savedMedia.length === 0 && currentPending.length === 0,
      progress: 0,
      uploading: false,
      queued: false,
    }));
    if (accepted.length < files.length)
      toast(
        `A product can have no more than ${PRODUCT_MEDIA_MAX_IMAGES} images.`,
        'error',
      );
    updatePending((current) => [...current, ...rows]);
    if (rows.length > 0) {
      setSaveNotice(
        activeProductIdRef.current
          ? `Validating and uploading ${rows.length} selected image${rows.length === 1 ? '' : 's'}…`
          : 'Checking product details and creating a draft to upload the selected image…',
      );
      void queuePendingUploads(rows.map((image) => image.key));
    }
  }

  async function uploadImage(
    image: PendingUpload,
    ownerProductId = activeProductId,
  ) {
    if (
      !ownerProductId ||
      !pendingRef.current.some((item) => item.key === image.key) ||
      uploadInFlightRef.current.has(image.key)
    ) {
      return;
    }
    setMediaConflictMessage('');
    markMediaMutation();
    uploadInFlightRef.current.add(image.key);
    setSaveNotice(`Uploading ${image.file.name}…`);
    updatePending((current) =>
      current.map((item) =>
        item.key === image.key
          ? {
              ...item,
              uploading: true,
              progress: 0,
              error: undefined,
              errorStatus: undefined,
              errorOperation: undefined,
            }
          : item,
      ),
    );
    const setFailure = (
      message: string,
      status?: number,
      operation: PendingUpload['errorOperation'] = 'image-upload',
    ) => {
      updatePending((current) =>
        current.map((item) =>
          item.key === image.key
            ? {
                ...item,
                uploading: false,
                error: message,
                errorStatus: status,
                errorOperation: operation,
              }
            : item,
        ),
      );
      setSaveNotice(
        `Upload failed for ${image.file.name}. The image remains pending; review its error and retry.`,
      );
    };
    try {
      const uploaded = await uploadAdminProductImage(
        ownerProductId,
        {
          file: image.file,
          alt: image.alt.trim(),
          view: image.view,
          isPrimary: image.isPrimary,
          lightingState: image.lightingState,
        },
        (progress) =>
          updatePending((current) =>
            current.map((item) =>
              item.key === image.key ? { ...item, progress } : item,
            ),
          ),
      );
      markMediaMutation();
      const currentMedia = getValues('media') ?? [];
      const uploadedId = mediaId(uploaded);
      const nextMedia = [
        ...currentMedia.filter(
          (item) => !uploadedId || mediaId(item) !== uploadedId,
        ),
        uploaded,
      ].map((item) =>
        uploaded.isPrimary &&
        mediaId(item) !== uploadedId &&
        (!uploaded.lightingState ||
          item.lightingState === uploaded.lightingState)
          ? { ...item, isPrimary: false }
          : item,
      );
      setValue('media', nextMedia, { shouldDirty: false });
      setCreatedProduct((current) =>
        current ? { ...current, media: nextMedia } : current,
      );
      queryClient.setQueryData(
        ['admin-product', ownerProductId],
        (current: AdminProduct | undefined) =>
          current ? { ...current, media: nextMedia } : current,
      );
      updatePending((current) =>
        current.filter((item) => item.key !== image.key),
      );
      URL.revokeObjectURL(image.preview);
      setSaveNotice(
        `Image uploaded successfully. ${nextMedia.length} saved image${nextMedia.length === 1 ? '' : 's'}; ${pendingRef.current.length} pending.`,
      );
      await queryClient.invalidateQueries({
        queryKey: ['admin-product', ownerProductId],
      });
      toast('Image uploaded.', 'success');
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'PRODUCT_MEDIA_CONFLICT'
      ) {
        setFailure(
          `${error.message} The latest gallery is being refreshed; review it before retrying this pending upload.`,
          error.status,
        );
        await refreshMediaAfterConflict('uploading this image', ownerProductId);
        return;
      }
      setFailure(
        error instanceof ApiError &&
          error.code === 'IMAGE_STORAGE_NOT_CONFIGURED'
          ? 'Cloudinary settings are missing on the server. Ask an administrator to configure product image storage.'
          : error instanceof ApiError
            ? error.message
            : 'Image upload failed.',
        error instanceof ApiError ? error.status : undefined,
      );
    } finally {
      uploadInFlightRef.current.delete(image.key);
    }
  }

  async function patchMedia(
    target: ProductMedia,
    changes: Partial<ProductMedia>,
  ) {
    if (!activeProductId) return;
    const id = mediaId(target);
    if (!id) return;
    const assigningLightingState = changes.lightingState !== undefined;
    if (
      assigningLightingState &&
      (!serverGalleryEnabled || assignmentInFlightRef.current.has(id))
    ) {
      return;
    }
    if (assigningLightingState) {
      assignmentInFlightRef.current.add(id);
      setAssignmentBusyIds((current) => new Set(current).add(id));
    }
    setMediaConflictMessage('');
    markMediaMutation();
    try {
      const updated = await api.updateProductMedia(
        activeProductId,
        id,
        changes,
      );
      markMediaMutation();
      if (changes.lightingState !== undefined || changes.isPrimary === true) {
        const reconciled = await refreshMediaAfterConflict();
        if (!reconciled) {
          toast(
            'Image changes were saved, but the latest primary-image state could not be confirmed. Refresh media before making another image change.',
            'error',
          );
        }
        return;
      }
      const currentMedia = getValues('media') ?? [];
      const updatedId = mediaId(updated) ?? id;
      const next = currentMedia.map((image) => {
        const isUpdatedImage = mediaId(image) === updatedId;
        return {
          ...image,
          ...(isUpdatedImage ? updated : {}),
          ...(updated.isPrimary &&
          mediaId(image) !== updatedId &&
          image.lightingState === updated.lightingState
            ? { isPrimary: false }
            : {}),
        };
      });
      setValue('media', next, { shouldDirty: true });
      await queryClient.invalidateQueries({
        queryKey: ['admin-product', activeProductId],
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'PRODUCT_MEDIA_CONFLICT'
      ) {
        await refreshMediaAfterConflict('updating image details');
        return;
      }
      toast(
        error instanceof ApiError
          ? error.message
          : 'Image details could not be updated.',
        'error',
      );
    } finally {
      if (assigningLightingState) {
        assignmentInFlightRef.current.delete(id);
        setAssignmentBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    }
  }

  async function reorderMedia(
    image: ProductMedia,
    groupMedia: ProductMedia[],
    index: number,
    delta: number,
  ) {
    if (!activeProductId) return;
    setMediaConflictMessage('');
    const next = [...media];
    const target = index + delta;
    if (target < 0 || target >= groupMedia.length) return;
    const currentId = mediaId(image);
    const targetId = mediaId(groupMedia[target]);
    const currentIndex = next.findIndex((item) => mediaId(item) === currentId);
    const targetIndex = next.findIndex((item) => mediaId(item) === targetId);
    if (currentIndex < 0 || targetIndex < 0) return;
    [next[currentIndex], next[targetIndex]] = [
      next[targetIndex],
      next[currentIndex],
    ];
    const ids = next.map(mediaId).filter((id): id is string => Boolean(id));
    try {
      await api.reorderProductMedia(activeProductId, ids);
      markMediaMutation();
      const orderById = new Map(
        ids.map((id, position): [string, number] => [id, position]),
      );
      const currentMedia = getValues('media') ?? [];
      setValue(
        'media',
        [...currentMedia]
          .sort((left, right) => {
            const leftOrder = orderById.get(mediaId(left) ?? '');
            const rightOrder = orderById.get(mediaId(right) ?? '');
            if (leftOrder === undefined && rightOrder === undefined)
              return left.sortOrder - right.sortOrder;
            if (leftOrder === undefined) return 1;
            if (rightOrder === undefined) return -1;
            return leftOrder - rightOrder;
          })
          .map((image, sortOrder) => ({ ...image, sortOrder })),
        { shouldDirty: true },
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'PRODUCT_MEDIA_CONFLICT'
      ) {
        await refreshMediaAfterConflict('reordering images');
        return;
      }
      toast(
        error instanceof ApiError
          ? error.message
          : 'Image order could not be saved.',
        'error',
      );
    }
  }

  function renderPendingUploads(lightingState?: ProductMedia['lightingState']) {
    const groupPending = pending.filter(
      (image) => image.lightingState === lightingState,
    );
    if (!groupPending.length) return null;
    return (
      <>
        <h4>Pending uploads ({groupPending.length})</h4>
        {groupPending.map((image) => (
          <div className="admin-pending-image" key={image.key}>
            <img src={image.preview} alt={`Preview for ${image.file.name}`} />
            <div>
              <strong>{image.file.name}</strong>
              <Input
                label="Alt text"
                value={image.alt}
                hint="Required: enter descriptive text (3–200 characters)."
                minLength={3}
                maxLength={200}
                disabled={image.uploading || image.queued}
                onChange={(event) =>
                  updatePending((current) =>
                    current.map((item) =>
                      item.key === image.key
                        ? { ...item, alt: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <Select
                label="View"
                value={image.view}
                disabled={image.uploading || image.queued}
                onChange={(event) =>
                  updatePending((current) =>
                    current.map((item) =>
                      item.key === image.key
                        ? {
                            ...item,
                            view: event.target.value as ProductMedia['view'],
                          }
                        : item,
                    ),
                  )
                }
              >
                {PRODUCT_MEDIA_VIEWS.map((view) => (
                  <option value={view.value} key={view.value}>
                    {view.label}
                  </option>
                ))}
              </Select>
              <Switch
                label={`Make primary${lightingState ? ` for Light ${lightingState.toUpperCase()}` : ''}`}
                checked={image.isPrimary}
                disabled={image.uploading || image.queued}
                onChange={(checked) =>
                  updatePending((current) =>
                    current.map((item) => ({
                      ...item,
                      isPrimary:
                        item.key === image.key
                          ? checked
                          : checked &&
                              item.lightingState === image.lightingState
                            ? false
                            : item.isPrimary,
                    })),
                  )
                }
              />
              {image.uploading ? (
                <>
                  <p className="admin-muted" aria-live="polite">
                    Uploading · {image.progress}%
                  </p>
                  <div
                    className="admin-upload-progress"
                    role="progressbar"
                    aria-label={`Uploading ${image.file.name}`}
                    aria-valuenow={image.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${image.progress}%` }} />
                  </div>
                </>
              ) : (
                <p className="admin-muted" aria-live="polite">
                  {image.error
                    ? 'Upload failed. Correct the issue or retry.'
                    : image.queued
                      ? 'Validating and preparing upload…'
                      : 'Waiting to upload'}
                </p>
              )}
              {image.error ? (
                <p className="field-error" role="alert">
                  {pendingUploadErrorOperationLabel(image.errorOperation)}{' '}
                  {image.errorStatus !== undefined
                    ? image.errorStatus > 0
                      ? `HTTP ${image.errorStatus}: `
                      : 'No HTTP response: '
                    : null}
                  {image.error}
                </p>
              ) : null}
              <div className="admin-upload-actions">
                {image.error ? (
                  <Button
                    type="button"
                    onClick={() => void queuePendingUploads([image.key])}
                    disabled={
                      !canWrite ||
                      image.uploading ||
                      image.queued ||
                      media.length >= PRODUCT_MEDIA_MAX_IMAGES
                    }
                  >
                    <Upload size={15} /> Retry upload
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={image.uploading || image.queued}
                  onClick={() => {
                    URL.revokeObjectURL(image.preview);
                    updatePending((current) =>
                      current.filter((item) => item.key !== image.key),
                    );
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ))}
      </>
    );
  }

  function renderSavedImages(groupMedia: ProductMedia[], state?: 'on' | 'off') {
    if (!groupMedia.length) {
      return <p className="admin-muted">No images in this group yet.</p>;
    }
    return (
      <div className="admin-media-gallery">
        {groupMedia.map((image, index) => {
          const id = mediaId(image);
          return (
            <div className="admin-media-card" key={id ?? image.url}>
              <img src={image.variants?.thumb ?? image.url} alt={image.alt} />
              {image.isPrimary ? <AdminStatusBadge status="primary" /> : null}
              <Input
                label="Alt text"
                value={image.alt}
                disabled={!canWrite}
                onChange={(event) =>
                  setValue(
                    'media',
                    (getValues('media') ?? []).map((item) =>
                      mediaId(item) === id
                        ? { ...item, alt: event.target.value }
                        : item,
                    ),
                    { shouldDirty: true },
                  )
                }
              />
              <Select
                label="View"
                value={image.view}
                disabled={!canWrite}
                onChange={(event) =>
                  setValue(
                    'media',
                    (getValues('media') ?? []).map((item) =>
                      mediaId(item) === id
                        ? {
                            ...item,
                            view: event.target.value as ProductMedia['view'],
                          }
                        : item,
                    ),
                    { shouldDirty: true },
                  )
                }
              >
                {PRODUCT_MEDIA_VIEWS.map((view) => (
                  <option value={view.value} key={view.value}>
                    {view.label}
                  </option>
                ))}
              </Select>
              {state ? (
                <Select
                  label="Lighting state"
                  value={image.lightingState ?? ''}
                  disabled={!canWrite}
                  onChange={(event) => {
                    const lightingState = event.target.value as 'on' | 'off';
                    void patchMedia(image, { lightingState });
                  }}
                >
                  <option value="on">Light ON</option>
                  <option value="off">Light OFF</option>
                </Select>
              ) : null}
              <div className="admin-media-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canWrite || image.isPrimary}
                  onClick={() => void patchMedia(image, { isPrimary: true })}
                >
                  Make primary
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canWrite || index === 0}
                  aria-label={`Move image earlier${state ? ` in Light ${state.toUpperCase()}` : ''}`}
                  onClick={() =>
                    void reorderMedia(image, groupMedia, index, -1)
                  }
                >
                  ←
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canWrite || index === groupMedia.length - 1}
                  aria-label={`Move image later${state ? ` in Light ${state.toUpperCase()}` : ''}`}
                  onClick={() => void reorderMedia(image, groupMedia, index, 1)}
                >
                  →
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!canWrite}
                  aria-label="Delete image"
                  onClick={() => setMediaDeleteTarget(image)}
                >
                  <Trash2 size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canWrite}
                  onClick={() =>
                    void patchMedia(image, {
                      alt: image.alt,
                      view: image.view,
                    })
                  }
                >
                  Save details
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  async function removeMedia(image: ProductMedia) {
    if (!activeProductId) return;
    const id = mediaId(image);
    if (!id) return;
    setMediaConflictMessage('');
    markMediaMutation();
    try {
      await api.deleteProductMedia(activeProductId, id);
      markMediaMutation();
      const reconciled = await refreshMediaAfterConflict();
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      if (reconciled) {
        toast('Image deleted.', 'success');
      } else {
        toast(
          'Image deleted, but the latest media state could not be confirmed. Refresh media before making another image change.',
          'error',
        );
      }
      setMediaDeleteTarget(null);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'IMAGE_DELETE_CLEANUP_FAILED'
      ) {
        markMediaMutation();
        const reconciled = await refreshMediaAfterConflict();
        await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
        toast(
          reconciled
            ? `The image was removed from the product, but storage cleanup failed: ${error.message}`
            : `The image was removed from the product, but storage cleanup failed: ${error.message} The latest media state could not be confirmed; refresh media before making another image change.`,
          'error',
        );
        setMediaDeleteTarget(null);
        return;
      }
      if (
        error instanceof ApiError &&
        error.code === 'PRODUCT_MEDIA_CONFLICT'
      ) {
        setMediaDeleteTarget(null);
        await refreshMediaAfterConflict('deleting this image');
        return;
      }
      toast(
        error instanceof ApiError && error.code === 'LAST_ACTIVE_PRODUCT_IMAGE'
          ? 'The last image cannot be removed from an active product. Add another image or deactivate the product first.'
          : error instanceof ApiError
            ? error.message
            : 'Image could not be deleted.',
        'error',
      );
      setMediaDeleteTarget(null);
    }
  }

  function focusFirstInvalid(errors: FieldErrors<ProductFormValues>) {
    const errorSections = new Set(
      Object.keys(errors)
        .map((field) => sectionByField[field as keyof ProductFormValues])
        .filter(
          (section): section is ProductEditorSection => section !== undefined,
        ),
    );
    if (errorSections.size) {
      setOpenSections((current) => new Set([...current, ...errorSections]));
    }
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        formElementRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      ),
    );
  }

  function toggleSection(section: ProductEditorSection) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    void handleSubmit(save, focusFirstInvalid)(event);
  }

  if (productQuery.isPending && productId) return <ProductEditorSkeleton />;
  if (isNew && settings.isPending) return <ProductEditorSkeleton />;
  if (isNew && settings.isError) {
    return (
      <section className="admin-panel">
        <ErrorState title="Store settings could not be loaded">
          The store currency is required before a product can be priced.
        </ErrorState>
        <Button variant="secondary" onClick={() => void settings.refetch()}>
          Try again
        </Button>
      </section>
    );
  }
  if (productQuery.isError) {
    return (
      <section className="admin-panel">
        <ErrorState title="Product could not be loaded">
          {productQuery.error instanceof ApiError
            ? productQuery.error.message
            : 'The product record is unavailable.'}
        </ErrorState>
        <Button variant="secondary" onClick={() => void productQuery.refetch()}>
          Try again
        </Button>
      </section>
    );
  }
  if (!canWrite && !can('products:read')) {
    return (
      <main className="admin-access-denied">
        <h1>You do not have permission to view products.</h1>
      </main>
    );
  }

  return (
    <form
      ref={formElementRef}
      className="admin-product-editor"
      onSubmit={submitForm}
      noValidate
    >
      <UnsavedChangesGuard dirty={isDirty || pending.length > 0} />
      <PageHeader
        title={isNew ? 'Add product' : values.title || 'Edit product'}
        description={
          isNew
            ? 'Create a draft product and add images as you go.'
            : `SKU ${values.sku || savedProduct?.sku || ''}`
        }
        actions={
          <Link
            className="button button--secondary button--md"
            href="/admin/products"
          >
            <ArrowLeft size={16} /> Products
          </Link>
        }
      />
      {serverError ? (
        <div className="auth-alert" role="alert">
          {serverError}
        </div>
      ) : null}
      {saveNotice ? (
        <div className="admin-inline-note" role="status" aria-live="polite">
          {saveNotice}
        </div>
      ) : null}
      <div className="admin-editor-columns">
        <div className="admin-editor-main">
          <EditorSection
            id="details"
            open={openSections.has('details')}
            onToggle={() => toggleSection('details')}
            title="Product Details & Discovery"
            helper="Set the product identity and customer-facing description."
          >
            <Input
              label="Product title"
              maxLength={200}
              error={errors.title?.message}
              disabled={!canWrite}
              {...register('title', {
                onChange: (event) => {
                  if (
                    !values.slug ||
                    values.slug === slugify(values.title ?? '')
                  )
                    setValue('slug', slugify(event.target.value), {
                      shouldDirty: true,
                    });
                },
              })}
            />
            <Input
              label="Slug"
              hint={`/product/${values.slug ?? ''}`}
              error={errors.slug?.message}
              disabled={!canWrite}
              {...register('slug')}
            />
            <Select
              label="Product type"
              value={productType}
              disabled={!canWrite}
              onChange={(event) => {
                const nextType = event.target
                  .value as ProductFormValues['productType'];
                const invalid = optionGroups.filter(
                  (group) =>
                    !PRODUCT_TYPE_OPTION_KEYS[nextType].includes(
                      group.key as never,
                    ),
                );
                if (
                  invalid.length &&
                  !window.confirm(
                    'Changing the product type will remove option groups that are not allowed for the new type. Continue?',
                  )
                )
                  return;
                setValue('productType', nextType, { shouldDirty: true });
                if (invalid.length)
                  setValue(
                    'optionGroups',
                    optionGroups.filter((group) => !invalid.includes(group)),
                    { shouldDirty: true },
                  );
                if (nextType === 'canvas_paint_yourself')
                  setValue('artworkRequired', false, { shouldDirty: true });
              }}
            >
              {PRODUCT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {canWrite ? (
              <SearchableSelect
                label="Category"
                value={values.category ?? ''}
                options={selectableCategories}
                disabled={categories.isPending}
                onChange={(value) => {
                  setValue('category', value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  clearErrors('category');
                }}
                error={errors.category?.message}
              />
            ) : (
              <Input
                label="Category"
                value={
                  flatCategories.find(
                    (category) => category.value === values.category,
                  )?.label ??
                  (typeof savedProduct?.category === 'object'
                    ? savedProduct.category.name
                    : values.category)
                }
                disabled
              />
            )}
            {selectedCategory ? (
              <p className="admin-muted" role="status">
                Form profile: {selectedCategoryProfile.replaceAll('_', ' ')}
              </p>
            ) : null}
            {categories.isError ? (
              <div>
                <p className="field-error" role="alert">
                  Categories could not be loaded. Retry before saving a new
                  product or changing its category.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void categories.refetch()}
                >
                  Retry categories
                </Button>
              </div>
            ) : categories.isPending ? (
              <p className="admin-muted" role="status">
                Loading categories…
              </p>
            ) : null}
            <Textarea
              label="Description"
              rows={6}
              maxLength={5000}
              disabled={!canWrite}
              error={errors.description?.message}
              {...register('description')}
            />
            <CharacterCounter
              label="Description"
              value={values.description ?? ''}
              max={5000}
            />
            <div className="field">
              <span className="field-label" id="product-themes-label">
                Themes
              </span>
              <div role="group" aria-labelledby="product-themes-label">
                {productThemes.map((theme) => (
                  <Checkbox
                    key={theme.value}
                    id={`product-theme-${theme.value}`}
                    label={theme.label}
                    checked={(values.themes ?? []).includes(theme.value)}
                    disabled={!canWrite}
                    onChange={(event) => {
                      const selected = values.themes ?? [];
                      const next = event.target.checked
                        ? [...selected, theme.value]
                        : selected.filter((value) => value !== theme.value);
                      setValue('themes', next, { shouldDirty: true });
                    }}
                  />
                ))}
              </div>
            </div>
          </EditorSection>

          <EditorSection
            id="pricing"
            open={openSections.has('pricing')}
            onToggle={() => toggleSection('pricing')}
            title="Pricing & Order Quantities"
            helper="Prices are entered in major currency units and sent to the API as integer minor units."
          >
            <MoneyField
              control={control}
              name="basePriceMinor"
              currency={currency}
              label="Base price"
              disabled={!canWrite}
              error={errors.basePriceMinor?.message}
              setValue={setValue}
            />
            <MoneyField
              control={control}
              name="compareAtPriceMinor"
              currency={currency}
              label="Compare-at price (optional)"
              disabled={!canWrite}
              error={errors.compareAtPriceMinor?.message}
              setValue={setValue}
            />
            {errors.compareAtPriceMinor?.message ? (
              <p className="field-error">
                {errors.compareAtPriceMinor.message}
              </p>
            ) : null}
            <QuantityTiers
              rows={values.quantityPricing ?? []}
              currency={currency}
              disabled={!canWrite}
              onChange={(rows) =>
                setValue('quantityPricing', rows, { shouldDirty: true })
              }
            />
            {errors.quantityPricing?.message ? (
              <p className="field-error">{errors.quantityPricing.message}</p>
            ) : null}
            <Input
              label="Minimum order quantity"
              type="number"
              min={1}
              disabled={!canWrite}
              {...register('minOrderQuantity', { valueAsNumber: true })}
            />
            <Input
              label="Maximum order quantity (optional)"
              type="number"
              min={1}
              disabled={!canWrite}
              {...register('maxOrderQuantity', {
                setValueAs: (value) =>
                  value === '' ? undefined : Number(value),
              })}
            />
            {errors.maxOrderQuantity?.message ? (
              <p className="field-error">{errors.maxOrderQuantity.message}</p>
            ) : null}
          </EditorSection>

          <EditorSection
            id="options"
            open={openSections.has('options')}
            onToggle={() => toggleSection('options')}
            title="Options & Variants"
            helper="Only option groups allowed for this product type are available. Values start empty."
          >
            <div className="admin-option-add">
              {profileAllowedOptionKeys
                .filter(
                  (key) => !optionGroups.some((group) => group.key === key),
                )
                .map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant="secondary"
                    type="button"
                    disabled={!canWrite}
                    onClick={() => addOptionGroup(key)}
                  >
                    <Plus size={14} /> Add {OPTION_LABELS[key] ?? key} group
                  </Button>
                ))}
            </div>
            {visibleOptionGroups.map((group) => {
              const groupIndex = optionGroups.indexOf(group);
              return (
                <OptionGroupEditor
                  key={`${group.key}-${groupIndex}`}
                  group={group}
                  groupIndex={groupIndex}
                  allowedKeys={[
                    group.key,
                    ...allowedOptionKeys.filter((key) => key !== group.key),
                  ]}
                  currency={currency}
                  disabled={!canWrite}
                  onChange={(changes) => updateOptionGroup(groupIndex, changes)}
                  onValueChange={(valueIndex, changes) =>
                    updateOptionValue(groupIndex, valueIndex, changes)
                  }
                  onAddValue={() => addOptionValue(groupIndex)}
                  onRemove={() =>
                    setValue(
                      'optionGroups',
                      optionGroups.filter((_, index) => index !== groupIndex),
                      { shouldDirty: true },
                    )
                  }
                />
              );
            })}
            {hiddenOptionGroupCount > 0 ? (
              <p className="admin-muted" role="status">
                {hiddenOptionGroupCount} option group
                {hiddenOptionGroupCount === 1 ? ' is' : 's are'} hidden for this
                profile and will be preserved when saved. Select a compatible
                category profile to edit them.
              </p>
            ) : null}
            {visibleOptionGroups.length ? (
              <section
                className="admin-customer-preview"
                aria-label="Customer view preview"
              >
                <h3>Customer view</h3>
                {visibleOptionGroups.map((group) => (
                  <label key={group.key}>
                    {group.label}
                    <select disabled>
                      <option>Select {group.label.toLowerCase()}</option>
                      {group.values.map((option, index) =>
                        option.label ? (
                          <option key={`${option.value}-${index}`}>
                            {option.label}
                          </option>
                        ) : null,
                      )}
                    </select>
                  </label>
                ))}
              </section>
            ) : optionGroups.length === 0 ? (
              <p className="admin-muted">No option groups configured.</p>
            ) : null}
          </EditorSection>

          <EditorSection
            id="production"
            open={openSections.has('production')}
            onToggle={() => toggleSection('production')}
            title="Production & Artwork"
            helper="Only add techniques and product details that apply to this item."
          >
            {showPrintTechniques ? (
              <MultiSelect
                label="Print techniques"
                options={PRINT_TECHNIQUES}
                value={values.printTechniques ?? []}
                disabled={!canWrite}
                onChange={(next) =>
                  setValue('printTechniques', next, { shouldDirty: true })
                }
              />
            ) : null}
            <SpecificationRepeater
              rows={values.specifications ?? []}
              disabled={!canWrite}
              onChange={(rows) =>
                setValue('specifications', rows, { shouldDirty: true })
              }
            />
            {showArtworkControls ? (
              <>
                <Switch
                  label="Artwork required"
                  checked={
                    paintCanvas ? false : Boolean(values.artworkRequired)
                  }
                  disabled={!canWrite || paintCanvas}
                  hint={
                    paintCanvas
                      ? 'Paint-It-Yourself Canvas does not require customer artwork.'
                      : undefined
                  }
                  onChange={(checked) =>
                    setValue('artworkRequired', checked, { shouldDirty: true })
                  }
                />
                <Input
                  label="Allowed artwork formats (comma-separated)"
                  value={(
                    values.artworkRequirements?.allowedFormats ?? []
                  ).join(', ')}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setValue(
                      'artworkRequirements.allowedFormats',
                      event.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean),
                      { shouldDirty: true },
                    )
                  }
                />
                <Textarea
                  label="Artwork requirements and customer guidance"
                  rows={3}
                  disabled={!canWrite}
                  {...register('artworkRequirements.notes')}
                />
              </>
            ) : null}
            {formProfile === 'three_d_printed' ||
            values.madeToOrder ||
            values.leadTimeDays !== undefined ? (
              <>
                <Switch
                  label="Made to order"
                  checked={Boolean(values.madeToOrder)}
                  disabled={!canWrite}
                  onChange={(checked) =>
                    setValue('madeToOrder', checked, { shouldDirty: true })
                  }
                />
                <Input
                  label="Lead time in days"
                  type="number"
                  min={0}
                  disabled={!canWrite}
                  {...register('leadTimeDays', {
                    setValueAs: (value) =>
                      value === '' ? undefined : Number(value),
                  })}
                />
              </>
            ) : null}
            <Textarea
              label="Eco note (optional)"
              rows={2}
              maxLength={300}
              disabled={!canWrite}
              {...register('ecoNote')}
            />
            <CharacterCounter
              label="Eco note"
              value={values.ecoNote ?? ''}
              max={300}
            />
            <p className="admin-muted">
              Shown to customers only if filled in. Only write claims you can
              support.
            </p>
          </EditorSection>

          <EditorSection
            id="inventory"
            open={openSections.has('inventory')}
            onToggle={() => toggleSection('inventory')}
            title="Inventory"
            helper="Inventory and order quantity values are managed by the server."
          >
            <Input
              label="SKU"
              maxLength={80}
              error={errors.sku?.message}
              disabled={!canWrite}
              {...register('sku')}
            />
            <Switch
              label="Track inventory"
              checked={Boolean(values.stock?.trackInventory)}
              disabled={!canWrite}
              onChange={(checked) =>
                setValue('stock.trackInventory', checked, { shouldDirty: true })
              }
            />
            <Input
              label="Quantity"
              type="number"
              min={0}
              disabled={!canWrite}
              {...register('stock.quantity', { valueAsNumber: true })}
            />
            <Input
              label="Low-stock threshold"
              type="number"
              min={0}
              disabled={!canWrite}
              {...register('stock.lowStockThreshold', { valueAsNumber: true })}
            />
            <Switch
              label="Allow backorder"
              checked={Boolean(values.stock?.allowBackorder)}
              disabled={!canWrite}
              onChange={(checked) =>
                setValue('stock.allowBackorder', checked, { shouldDirty: true })
              }
            />
          </EditorSection>

          <EditorSection
            id="images"
            open={openSections.has('images')}
            onToggle={() => toggleSection('images')}
            title="Images"
            helper={`Add up to ${PRODUCT_MEDIA_MAX_IMAGES} images. Uploads are private and handled by the configured product image store.`}
          >
            {showLightingGallerySetting ? (
              <div className="admin-inline-note">
                <Switch
                  label="Enable Light ON/OFF image groups"
                  checked={values.lightingGalleryEnabled ?? false}
                  disabled={
                    !canWrite ||
                    (!lightingGalleryEligible && !values.lightingGalleryEnabled)
                  }
                  onChange={(checked) => {
                    if (pendingRef.current.length > 0) {
                      toast(
                        'Upload or remove pending images before changing the lighting-gallery setting.',
                        'error',
                      );
                      return;
                    }
                    setValue('lightingGalleryEnabled', checked, {
                      shouldDirty: true,
                    });
                  }}
                />
                <p className="admin-muted">
                  This setting is available for the Lamps and Lighting category.
                  Existing images are never automatically assigned to a lighting
                  state.
                </p>
                {values.lightingGalleryEnabled && !serverGalleryEnabled ? (
                  <p className="admin-inline-note" role="status">
                    Save Changes to enable lighting assignments.
                  </p>
                ) : null}
              </div>
            ) : null}
            {pending.length > 0 ? (
              <p className="admin-inline-note">
                Selected images upload automatically after validation. If
                product details are incomplete, complete the required fields and
                retry or save the draft. Leaving or closing the editor before
                upload completes will discard pending files.
              </p>
            ) : null}
            {values.lightingGalleryEnabled ? (
              <>
                {mediaConflictMessage ? (
                  <div className="admin-inline-note" role="alert">
                    <p>{mediaConflictMessage}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={mediaConflictBusy}
                      onClick={() => void refreshMediaAfterConflict()}
                    >
                      {mediaConflictBusy
                        ? 'Refreshing media…'
                        : 'Refresh media'}
                    </Button>
                  </div>
                ) : null}
                <p className="admin-muted" aria-live="polite">
                  {media.length} of {PRODUCT_MEDIA_MAX_IMAGES} saved images
                  {pending.length > 0 ? ` · ${pending.length} pending` : ''}
                </p>
                {(['on', 'off'] as const).map((state) => {
                  const groupMedia = media.filter(
                    (image) => image.lightingState === state,
                  );
                  return (
                    <fieldset
                      className="admin-option-group"
                      key={state}
                      disabled={!canWrite}
                    >
                      <legend>
                        Light {state.toUpperCase()} ({groupMedia.length})
                      </legend>
                      <ImageDropzone
                        disabled={
                          !canWrite ||
                          isSubmitting ||
                          media.length + pending.length >=
                            PRODUCT_MEDIA_MAX_IMAGES
                        }
                        onFiles={(files) => addFiles(files, state)}
                      />
                      {renderPendingUploads(state)}
                      <h4>Saved images</h4>
                      {renderSavedImages(groupMedia, state)}
                    </fieldset>
                  );
                })}
                {(() => {
                  const unassigned = media.filter(
                    (image) => !image.lightingState,
                  );
                  return unassigned.length ? (
                    <section aria-labelledby="unassigned-media-heading">
                      <h3 id="unassigned-media-heading">
                        Unassigned legacy images ({unassigned.length})
                      </h3>
                      <p className="admin-muted">
                        Assign each image explicitly before it can appear in
                        either lighting gallery.
                      </p>
                      <div className="admin-media-gallery">
                        {unassigned.map((image) => (
                          <div
                            className="admin-media-card"
                            key={mediaId(image) ?? image.url}
                          >
                            <img
                              src={image.variants?.thumb ?? image.url}
                              alt={image.alt}
                            />
                            <p>{image.alt}</p>
                            <div className="admin-media-actions">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={
                                  !canWrite ||
                                  !serverGalleryEnabled ||
                                  assignmentBusyIds.has(mediaId(image) ?? '')
                                }
                                loading={assignmentBusyIds.has(
                                  mediaId(image) ?? '',
                                )}
                                onClick={() =>
                                  void patchMedia(image, {
                                    lightingState: 'on',
                                  })
                                }
                              >
                                Assign to Light ON
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={
                                  !canWrite ||
                                  !serverGalleryEnabled ||
                                  assignmentBusyIds.has(mediaId(image) ?? '')
                                }
                                loading={assignmentBusyIds.has(
                                  mediaId(image) ?? '',
                                )}
                                onClick={() =>
                                  void patchMedia(image, {
                                    lightingState: 'off',
                                  })
                                }
                              >
                                Assign to Light OFF
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null;
                })()}
              </>
            ) : (
              <>
                {mediaConflictMessage ? (
                  <div className="admin-inline-note" role="alert">
                    <p>{mediaConflictMessage}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={mediaConflictBusy}
                      onClick={() => void refreshMediaAfterConflict()}
                    >
                      {mediaConflictBusy
                        ? 'Refreshing media…'
                        : 'Refresh media'}
                    </Button>
                  </div>
                ) : null}
                <p className="admin-muted" aria-live="polite">
                  {media.length} of {PRODUCT_MEDIA_MAX_IMAGES} saved images
                  {pending.length > 0 ? ` · ${pending.length} pending` : ''}
                </p>
                <ImageDropzone
                  disabled={
                    !canWrite ||
                    isSubmitting ||
                    media.length + pending.length >= PRODUCT_MEDIA_MAX_IMAGES
                  }
                  onFiles={addFiles}
                />
                {pending.length > 0 ? (
                  <h3>Pending uploads ({pending.length})</h3>
                ) : null}
                {pending.map((image) => (
                  <div className="admin-pending-image" key={image.key}>
                    <img
                      src={image.preview}
                      alt={`Preview for ${image.file.name}`}
                    />
                    <div>
                      <strong>{image.file.name}</strong>
                      <Input
                        label="Alt text"
                        value={image.alt}
                        hint="Required: enter descriptive text (3–200 characters)."
                        minLength={3}
                        maxLength={200}
                        disabled={image.uploading || image.queued}
                        onChange={(event) =>
                          updatePending((current) =>
                            current.map((item) =>
                              item.key === image.key
                                ? { ...item, alt: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <Select
                        label="View"
                        value={image.view}
                        disabled={image.uploading || image.queued}
                        onChange={(event) =>
                          updatePending((current) =>
                            current.map((item) =>
                              item.key === image.key
                                ? {
                                    ...item,
                                    view: event.target
                                      .value as ProductMedia['view'],
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        {PRODUCT_MEDIA_VIEWS.map((view) => (
                          <option value={view.value} key={view.value}>
                            {view.label}
                          </option>
                        ))}
                      </Select>
                      <Switch
                        label="Make primary"
                        checked={image.isPrimary}
                        disabled={image.uploading || image.queued}
                        onChange={(checked) =>
                          updatePending((current) =>
                            current.map((item) => ({
                              ...item,
                              isPrimary:
                                item.key === image.key
                                  ? checked
                                  : checked
                                    ? false
                                    : item.isPrimary,
                            })),
                          )
                        }
                      />
                      {image.uploading ? (
                        <>
                          <p className="admin-muted" aria-live="polite">
                            Uploading · {image.progress}%
                          </p>
                          <div
                            className="admin-upload-progress"
                            role="progressbar"
                            aria-label={`Uploading ${image.file.name}`}
                            aria-valuenow={image.progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <span style={{ width: `${image.progress}%` }} />
                          </div>
                        </>
                      ) : (
                        <p className="admin-muted" aria-live="polite">
                          {image.error
                            ? 'Upload failed. Correct the issue or retry.'
                            : image.queued
                              ? 'Validating and preparing upload…'
                              : 'Waiting to upload'}
                        </p>
                      )}
                      {image.error ? (
                        <p className="field-error" role="alert">
                          {pendingUploadErrorOperationLabel(
                            image.errorOperation,
                          )}{' '}
                          {image.errorStatus !== undefined
                            ? image.errorStatus > 0
                              ? `HTTP ${image.errorStatus}: `
                              : 'No HTTP response: '
                            : null}
                          {image.error}
                        </p>
                      ) : null}
                      <div className="admin-upload-actions">
                        {image.error ? (
                          <Button
                            type="button"
                            onClick={() =>
                              void queuePendingUploads([image.key])
                            }
                            disabled={
                              !canWrite ||
                              isSubmitting ||
                              image.uploading ||
                              image.queued ||
                              media.length >= PRODUCT_MEDIA_MAX_IMAGES
                            }
                          >
                            <Upload size={15} /> Retry upload
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={image.uploading || image.queued}
                          onClick={() => {
                            URL.revokeObjectURL(image.preview);
                            updatePending((current) =>
                              current.filter((item) => item.key !== image.key),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                <h3>Saved images ({media.length})</h3>
                {media.length ? (
                  <div className="admin-media-gallery">
                    {media.map((image, index) => (
                      <div
                        className="admin-media-card"
                        key={mediaId(image) ?? image.url}
                      >
                        <img
                          src={image.variants?.thumb ?? image.url}
                          alt={image.alt}
                        />
                        {image.isPrimary ? (
                          <AdminStatusBadge status="primary" />
                        ) : null}
                        <Input
                          label="Alt text"
                          value={image.alt}
                          disabled={!canWrite}
                          onChange={(event) =>
                            setValue(
                              'media',
                              media.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, alt: event.target.value }
                                  : item,
                              ),
                              { shouldDirty: true },
                            )
                          }
                        />
                        <Select
                          label="View"
                          value={image.view}
                          disabled={!canWrite}
                          onChange={(event) =>
                            setValue(
                              'media',
                              media.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      view: event.target
                                        .value as ProductMedia['view'],
                                    }
                                  : item,
                              ),
                              { shouldDirty: true },
                            )
                          }
                        >
                          {PRODUCT_MEDIA_VIEWS.map((view) => (
                            <option value={view.value} key={view.value}>
                              {view.label}
                            </option>
                          ))}
                        </Select>
                        <div className="admin-media-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canWrite || image.isPrimary}
                            onClick={() =>
                              void patchMedia(image, { isPrimary: true })
                            }
                          >
                            Make primary
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite || index === 0}
                            aria-label="Move image left"
                            onClick={() =>
                              void reorderMedia(image, media, index, -1)
                            }
                          >
                            ←
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite || index === media.length - 1}
                            aria-label="Move image right"
                            onClick={() =>
                              void reorderMedia(image, media, index, 1)
                            }
                          >
                            →
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={!canWrite}
                            aria-label="Delete image"
                            onClick={() => setMediaDeleteTarget(image)}
                          >
                            <Trash2 size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite}
                            onClick={() =>
                              void patchMedia(image, {
                                alt: image.alt,
                                view: image.view,
                              })
                            }
                          >
                            Save details
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="admin-muted">
                    No product images have been uploaded yet.
                  </p>
                )}
              </>
            )}
          </EditorSection>

          <EditorSection
            id="search"
            open={openSections.has('search')}
            onToggle={() => toggleSection('search')}
            title="Search appearance"
            helper="Preview how this product may appear in search results."
          >
            <Input
              label="Meta title"
              maxLength={60}
              disabled={!canWrite}
              {...register('seo.metaTitle')}
            />
            <CharacterCounter
              label="Meta title"
              value={values.seo?.metaTitle ?? ''}
              max={60}
            />
            <Textarea
              label="Meta description"
              rows={3}
              maxLength={160}
              disabled={!canWrite}
              {...register('seo.metaDescription')}
            />
            <CharacterCounter
              label="Meta description"
              value={values.seo?.metaDescription ?? ''}
              max={160}
            />
            <Input
              label="Canonical URL (optional)"
              type="url"
              disabled={!canWrite}
              error={errors.seo?.canonicalUrl?.message}
              {...register('seo.canonicalUrl')}
            />
            <div className="admin-search-preview">
              <strong>
                {values.seo?.metaTitle || values.title || 'Product title'}
              </strong>
              <span>
                {values.seo?.canonicalUrl ||
                  `/product/${values.slug || 'product-slug'}`}
              </span>
              <p>
                {values.seo?.metaDescription ||
                  values.description ||
                  'Product description preview'}
              </p>
            </div>
          </EditorSection>
        </div>

        <aside className="admin-editor-sidebar">
          <section className="admin-panel admin-editor-summary-card">
            <h2>Status</h2>
            <p>
              <AdminStatusBadge status={values.status ?? 'draft'} />
            </p>
            <div className="admin-ready-checklist">
              <h3>Ready to publish</h3>
              {readyChecks.map(([label, valid]) => (
                <p key={label} className={valid ? 'is-ready' : 'is-missing'}>
                  {valid ? <Check size={16} /> : <CircleAlert size={16} />}{' '}
                  {label}
                </p>
              ))}
            </div>
            {!isNew ? (
              <Select
                label="Product status"
                value={values.status}
                disabled={!canWrite || statusBusy}
                onChange={(event) =>
                  void setStatus(event.target.value as ProductStatus)
                }
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="out_of_stock">Out of stock</option>
              </Select>
            ) : (
              <p className="admin-muted">New products are saved as drafts.</p>
            )}
            <Button
              type="button"
              disabled={
                !canWrite ||
                !activeProductId ||
                !canActivate ||
                statusBusy ||
                values.status === 'active'
              }
              loading={statusBusy && values.status !== 'active'}
              onClick={() => void setStatus('active')}
            >
              {values.status === 'active' ? 'Published' : 'Publish / Activate'}
            </Button>
            <Switch
              label="Featured"
              checked={Boolean(values.isFeatured)}
              disabled={!canWrite}
              onChange={(checked) =>
                setValue('isFeatured', checked, { shouldDirty: true })
              }
            />
            {savedProduct ? (
              <div className="admin-readonly-summary">
                <p>
                  Created{' '}
                  <time dateTime={savedProduct.createdAt}>
                    {new Date(savedProduct.createdAt).toLocaleDateString()}
                  </time>
                </p>
                <p>
                  Updated{' '}
                  <time dateTime={savedProduct.updatedAt}>
                    {new Date(savedProduct.updatedAt).toLocaleDateString()}
                  </time>
                </p>
                <p>Views {savedProduct.viewCount}</p>
                <p>Units sold {savedProduct.soldCount}</p>
              </div>
            ) : null}
            {values.status === 'active' && values.slug ? (
              <a
                className="admin-editor-storefront-link"
                href={`/product/${values.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                View on storefront <ExternalLink size={15} />
              </a>
            ) : null}
          </section>
          {canWrite && activeProductId ? (
            <section className="admin-panel admin-danger-zone">
              <h2>Danger zone</h2>
              <p>
                Products with order history are archived by the server instead
                of deleted.
              </p>
              <Button
                variant="danger"
                type="button"
                onClick={() => void setStatus('archived')}
              >
                <Archive size={15} /> Archive product
              </Button>
              <Button
                variant="danger"
                type="button"
                disabled={pending.length > 0}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={15} /> Delete product
              </Button>
            </section>
          ) : null}
        </aside>
      </div>
      {canWrite && (isDirty || pending.length > 0) ? (
        <StickySaveBar
          onSave={() => void handleSubmit(save, focusFirstInvalid)()}
          onDiscard={() => {
            if (savedProduct) reset(toFormValues(savedProduct));
            else reset(emptyProduct(currency));
            updatePending((current) => {
              current.forEach((image) => URL.revokeObjectURL(image.preview));
              return [];
            });
          }}
          saving={isSubmitting}
          saveLabel={isNew ? 'Save draft' : 'Save changes'}
        />
      ) : null}
      <AdminConfirmDialog
        open={deleteOpen}
        title="Delete or archive product?"
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteProduct()}
      >
        The server deletes a product only when it has no order history;
        otherwise it archives the record to preserve orders.
      </AdminConfirmDialog>
      <AdminConfirmDialog
        open={Boolean(mediaDeleteTarget)}
        title="Delete product image?"
        onClose={() => setMediaDeleteTarget(null)}
        onConfirm={() =>
          mediaDeleteTarget && void removeMedia(mediaDeleteTarget)
        }
      >
        {mediaDeleteTarget?.isPrimary
          ? 'This is the primary product image. The server may prevent removing the last image from an active product.'
          : 'This image will be removed from the product gallery.'}
      </AdminConfirmDialog>
      <p className="visually-hidden" aria-live="polite">
        {serverError}
      </p>
    </form>
  );
}

function toFormValues(product: AdminProduct): ProductFormValues {
  const {
    _id: id,
    createdAt,
    updatedAt,
    viewCount,
    soldCount,
    ratingAverage,
    ratingCount,
    ...editable
  } = product;
  void id;
  void createdAt;
  void updatedAt;
  void viewCount;
  void soldCount;
  void ratingAverage;
  void ratingCount;
  return {
    ...emptyProduct(product.currency),
    ...editable,
    category:
      typeof product.category === 'string'
        ? product.category
        : product.category._id,
    themes: product.themes ?? [],
    media: product.media ?? [],
    optionGroups: product.optionGroups ?? [],
    quantityPricing: product.quantityPricing ?? [],
    printTechniques: product.printTechniques ?? [],
    specifications: product.specifications ?? [],
    artworkRequirements: product.artworkRequirements ?? { allowedFormats: [] },
    stock: product.stock,
    seo: product.seo ?? {},
    ecoNote: product.ecoNote ?? '',
  };
}

function imageDimensions(
  source: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Image could not be read'));
    image.src = source;
  });
}

function EditorSection({
  id,
  title,
  helper,
  open,
  onToggle,
  children,
}: {
  id: ProductEditorSection;
  title: string;
  helper: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`admin-panel admin-editor-section${open ? ' is-open' : ''}`}
      data-product-section={id}
    >
      <header>
        <h2>
          <button
            className="admin-editor-accordion-trigger"
            type="button"
            aria-expanded={open}
            aria-controls={`product-section-${id}`}
            onClick={onToggle}
          >
            <span>{title}</span>
            <ChevronDown size={20} aria-hidden="true" />
          </button>
        </h2>
        <p>{helper}</p>
      </header>
      <div
        id={`product-section-${id}`}
        className="admin-editor-accordion-content"
        hidden={!open}
      >
        <div className="admin-editor-fields">{children}</div>
      </div>
    </section>
  );
}

function MoneyField({
  control,
  name,
  currency,
  label,
  disabled,
  error,
  setValue,
}: {
  control: ReturnType<typeof useForm<ProductFormValues>>['control'];
  name: 'basePriceMinor' | 'compareAtPriceMinor';
  currency: string;
  label: string;
  disabled: boolean;
  error?: string;
  setValue: ReturnType<typeof useForm<ProductFormValues>>['setValue'];
}) {
  const value = useWatch({ control, name });
  return (
    <MoneyInput
      label={label}
      currency={currency}
      valueMinor={value}
      disabled={disabled}
      error={error}
      onChange={(next) =>
        setValue(name, next, { shouldDirty: true, shouldValidate: true })
      }
    />
  );
}

function QuantityTiers({
  rows,
  currency,
  disabled,
  onChange,
}: {
  rows: Array<{ minQty: number; unitPriceMinor: number }>;
  currency: string;
  disabled: boolean;
  onChange: (rows: Array<{ minQty: number; unitPriceMinor: number }>) => void;
}) {
  return (
    <Repeater
      label="bulk pricing tier"
      rows={rows}
      createRow={() => ({ minQty: 2, unitPriceMinor: 0 })}
      disabled={disabled}
      onChange={onChange}
      renderRow={(row, index) => (
        <>
          <Input
            label={`Minimum quantity ${index + 1}`}
            type="number"
            min={1}
            value={row.minQty}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                rows.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, minQty: Number(event.target.value) }
                    : item,
                ),
              )
            }
          />
          <MoneyInput
            label={`Unit price ${index + 1}`}
            currency={currency}
            valueMinor={row.unitPriceMinor}
            disabled={disabled}
            onChange={(unitPriceMinor) =>
              onChange(
                rows.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, unitPriceMinor: unitPriceMinor ?? 0 }
                    : item,
                ),
              )
            }
          />
        </>
      )}
    />
  );
}

function SpecificationRepeater({
  rows,
  disabled,
  onChange,
}: {
  rows: Array<{ label: string; value: string }>;
  disabled: boolean;
  onChange: (rows: Array<{ label: string; value: string }>) => void;
}) {
  return (
    <Repeater
      label="specification"
      rows={rows}
      createRow={() => ({ label: '', value: '' })}
      disabled={disabled}
      onChange={onChange}
      renderRow={(row, index) => (
        <>
          <Input
            label={`Specification label ${index + 1}`}
            value={row.label}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                rows.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, label: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Input
            label={`Specification value ${index + 1}`}
            value={row.value}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                rows.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, value: event.target.value }
                    : item,
                ),
              )
            }
          />
        </>
      )}
    />
  );
}

function OptionGroupEditor({
  group,
  groupIndex,
  allowedKeys,
  currency,
  disabled,
  onChange,
  onValueChange,
  onAddValue,
  onRemove,
}: {
  group: ProductFormValues['optionGroups'][number];
  groupIndex: number;
  allowedKeys: readonly string[];
  currency: string;
  disabled: boolean;
  onChange: (value: Partial<ProductFormValues['optionGroups'][number]>) => void;
  onValueChange: (
    index: number,
    value: Partial<ProductFormValues['optionGroups'][number]['values'][number]>,
  ) => void;
  onAddValue: () => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="admin-option-group" disabled={disabled}>
      <legend>{group.label || `Option group ${groupIndex + 1}`}</legend>
      <div className="admin-editor-fields">
        <Select
          label="Option key"
          value={group.key}
          onChange={(event) =>
            onChange({
              key: event.target.value,
              label: OPTION_LABELS[event.target.value] ?? event.target.value,
            })
          }
        >
          {allowedKeys.map((key) => (
            <option value={key} key={key}>
              {OPTION_LABELS[key] ?? key}
            </option>
          ))}
        </Select>
        <Input
          label="Display label"
          value={group.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
        <Switch
          label="Required"
          checked={group.required}
          onChange={(required) => onChange({ required })}
        />
      </div>
      {group.values.map((value, valueIndex) => (
        <div className="admin-option-value" key={valueIndex}>
          <Input
            label="Customer label"
            value={value.label}
            onChange={(event) => {
              const text = event.target.value;
              onValueChange(valueIndex, {
                label: text,
                ...(!value.value || value.value === slugify(value.label)
                  ? { value: slugify(text) }
                  : {}),
              });
            }}
          />
          <Input
            label="Stored value"
            value={value.value}
            onChange={(event) =>
              onValueChange(valueIndex, { value: event.target.value })
            }
          />
          <MoneyInput
            label="Price modifier"
            currency={currency}
            valueMinor={value.priceModifierMinor}
            onChange={(priceModifierMinor) =>
              onValueChange(valueIndex, {
                priceModifierMinor: priceModifierMinor ?? 0,
              })
            }
          />
          {group.key === 'color' || group.key === 'colour' ? (
            <label className="field">
              <span className="field-label">Colour swatch</span>
              <span className="admin-color-input">
                <input
                  type="color"
                  value={
                    /^#[0-9a-f]{6}$/i.test(value.hex ?? '')
                      ? value.hex
                      : '#ffffff'
                  }
                  aria-label="Option colour swatch"
                  onChange={(event) =>
                    onValueChange(valueIndex, { hex: event.target.value })
                  }
                />
                <span>{value.label || 'No label'}</span>
              </span>
            </label>
          ) : null}
          <Input
            label="SKU suffix (optional)"
            maxLength={32}
            value={value.skuSuffix ?? ''}
            onChange={(event) =>
              onValueChange(valueIndex, { skuSuffix: event.target.value })
            }
          />
          <Switch
            label="Available"
            checked={value.isAvailable}
            onChange={(isAvailable) =>
              onValueChange(valueIndex, { isAvailable })
            }
          />
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() =>
              onChange({
                values: group.values.filter((_, index) => index !== valueIndex),
              })
            }
          >
            Remove value
          </Button>
        </div>
      ))}
      <div className="admin-option-group-actions">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onAddValue}
        >
          <Plus size={14} /> Add value
        </Button>
        <Button type="button" size="sm" variant="danger" onClick={onRemove}>
          <Trash2 size={14} /> Remove group
        </Button>
      </div>
    </fieldset>
  );
}

function ProductEditorSkeleton() {
  return (
    <section
      className="admin-panel admin-editor-skeleton"
      role="status"
      aria-label="Loading product"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span className="loading-skeleton" key={index} />
      ))}
    </section>
  );
}

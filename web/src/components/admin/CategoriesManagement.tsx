'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import {
  AdminConfirmDialog,
  AdminEmptyState,
  AdminStatusBadge,
  PageHeader,
} from '@/components/admin';
import { AdminIconButton } from '@/components/admin/AdminIconButton';
import {
  Button,
  ErrorState,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { AdminCategory } from '@/lib/api/types';
import { usePermissions } from '@/components/providers/AuthProvider';

const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(160),
  image: z.string().trim().max(2048),
  parent: z.string().nullable(),
  description: z.string().trim().max(2000),
  formProfile: z.enum([
    'apparel',
    'drinkware',
    'canvas_art',
    'three_d_printed',
    'bags',
    'general',
  ]),
  sortOrder: z.number().int().nonnegative(),
  isActive: z.boolean(),
});
type CategoryValues = z.infer<typeof categorySchema>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function flatten(
  categories: AdminCategory[],
  depth = 0,
): Array<{ category: AdminCategory; depth: number }> {
  return categories.flatMap((category) => [
    { category, depth },
    ...flatten(category.children, depth + 1),
  ]);
}

function descendants(category: AdminCategory): Set<string> {
  return new Set([
    category._id,
    ...category.children.flatMap((child) => [...descendants(child)]),
  ]);
}

export function CategoriesManagement() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can('products:write');
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: api.adminCategories,
    retry: false,
    enabled: canWrite,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [serverError, setServerError] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: '',
      slug: '',
      image: '',
      parent: null,
      description: '',
      formProfile: 'general',
      sortOrder: 0,
      isActive: true,
    },
  });
  const active = useWatch({ control, name: 'isActive' });
  const formSlug = useWatch({ control, name: 'slug' });
  const focusRef = useRef<HTMLInputElement>(null);
  const nameRegistration = register('name', {
    onChange: (event) => {
      if (!slugTouched)
        setValue('slug', slugify(event.target.value), { shouldDirty: true });
    },
  });

  const flat = useMemo(() => flatten(categories.data ?? []), [categories.data]);
  const editBlockedIds = editing ? descendants(editing) : new Set<string>();
  const parentOptions = flat.filter(
    ({ category }) => !editBlockedIds.has(category._id),
  );

  if (!canWrite) {
    return (
      <main className="admin-access-denied">
        <h1>You do not have permission to manage categories.</h1>
      </main>
    );
  }

  function startEditor(
    category: AdminCategory | null,
    parentId: string | null = null,
  ) {
    setEditing(category);
    setServerError('');
    setSlugTouched(Boolean(category));
    reset(
      category
        ? {
            name: category.name,
            slug: category.slug,
            image: category.image ?? '',
            parent: category.parent ?? null,
            description: category.description ?? '',
            formProfile: category.formProfile ?? 'general',
            sortOrder: category.sortOrder,
            isActive: category.isActive,
          }
        : {
            name: '',
            slug: '',
            image: '',
            parent: parentId,
            description: '',
            formProfile: 'general',
            sortOrder: 0,
            isActive: true,
          },
    );
    setEditorOpen(true);
  }

  async function save(values: CategoryValues) {
    setServerError('');
    try {
      const payload = { ...values, parent: values.parent || null };
      if (editing) await api.updateAdminCategory(editing._id, payload);
      else await api.createAdminCategory(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
      ]);
      toast(editing ? 'Category updated.' : 'Category created.', 'success');
      setEditorOpen(false);
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'The category could not be saved.',
      );
    }
  }

  async function changeActive(category: AdminCategory) {
    try {
      await api.updateAdminCategory(category._id, {
        isActive: !category.isActive,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
      ]);
      toast(
        category.isActive ? 'Category deactivated.' : 'Category activated.',
        'success',
      );
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'Category status could not be changed.',
        'error',
      );
    }
  }

  async function removeCategory() {
    if (!deleting) return;
    try {
      await api.deleteAdminCategory(deleting._id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
      ]);
      toast('Category deleted.', 'success');
      setDeleting(null);
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === 'CATEGORY_HAS_PRODUCTS'
          ? 'This category still has products or subcategories. Move the products and child categories first, or deactivate the category instead.'
          : error instanceof ApiError
            ? error.message
            : 'Category could not be deleted.';
      toast(message, 'error');
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="Organize the product catalog with parent and child categories."
        actions={
          canWrite ? (
            <Button onClick={() => startEditor(null)}>
              <Plus size={17} aria-hidden="true" /> Add category
            </Button>
          ) : null
        }
      />
      {categories.isPending ? (
        <section
          className="admin-panel admin-loading-block"
          role="status"
          aria-label="Loading categories"
        >
          <span className="loading-skeleton" />
          <span className="loading-skeleton" />
          <span className="loading-skeleton" />
        </section>
      ) : categories.isError ? (
        <section className="admin-panel">
          <ErrorState title="Categories could not be loaded">
            The category list is unavailable.
          </ErrorState>
          <Button variant="secondary" onClick={() => void categories.refetch()}>
            Try again
          </Button>
        </section>
      ) : categories.data?.length ? (
        <section className="admin-panel admin-category-tree">
          <div className="admin-category-header" aria-hidden="true">
            <span>Category</span>
            <span>Products</span>
            <span>Sort order</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {flat
            .filter(
              ({ category, depth }) =>
                depth === 0 || expanded.has(category.parent ?? ''),
            )
            .map(({ category, depth }) => {
              const hasChildren = category.children.length > 0;
              const open = expanded.has(category._id);
              return (
                <div className="admin-category-row" key={category._id}>
                  <div
                    className="admin-category-name"
                    style={{ paddingInlineStart: `${depth * 1.4}rem` }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${category.name}`}
                        aria-expanded={open}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous);
                            if (open) next.delete(category._id);
                            else next.add(category._id);
                            return next;
                          })
                        }
                      >
                        {open ? (
                          <ChevronDown size={17} />
                        ) : (
                          <ChevronRight size={17} />
                        )}
                      </button>
                    ) : (
                      <span className="admin-category-spacer" />
                    )}
                    <strong>{category.name}</strong>
                    <small>/{category.slug}</small>
                  </div>
                  <span data-label="Products">{category.productCount}</span>
                  <span data-label="Sort order">{category.sortOrder}</span>
                  <span data-label="Status">
                    <AdminStatusBadge
                      status={category.isActive ? 'active' : 'inactive'}
                    />
                  </span>
                  {canWrite ? (
                    <div
                      className="admin-icon-actions admin-category-actions"
                      role="group"
                      aria-label={`Actions for ${category.name}`}
                    >
                      <AdminIconButton
                        label={`Edit ${category.name}`}
                        onClick={() => startEditor(category)}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </AdminIconButton>
                      <AdminIconButton
                        label={`Add subcategory to ${category.name}`}
                        onClick={() => startEditor(null, category._id)}
                      >
                        <FolderPlus size={16} aria-hidden="true" />
                      </AdminIconButton>
                      <AdminIconButton
                        label={`${category.isActive ? 'Deactivate' : 'Activate'} ${category.name}`}
                        onClick={() => void changeActive(category)}
                      >
                        {category.isActive ? (
                          <PowerOff size={16} aria-hidden="true" />
                        ) : (
                          <Power size={16} aria-hidden="true" />
                        )}
                      </AdminIconButton>
                      <AdminIconButton
                        label={`Delete ${category.name}`}
                        danger
                        onClick={() => setDeleting(category)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </AdminIconButton>
                    </div>
                  ) : (
                    <span className="admin-muted">Read only</span>
                  )}
                </div>
              );
            })}
        </section>
      ) : (
        <section className="admin-panel">
          <AdminEmptyState title="No categories yet">
            Create a category before adding products to the catalog.
            {canWrite ? (
              <div className="admin-empty-action">
                <Button onClick={() => startEditor(null)}>Add category</Button>
              </div>
            ) : null}
          </AdminEmptyState>
        </section>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit category' : 'Add category'}
        initialFocusRef={focusRef}
      >
        <form
          className="admin-form"
          onSubmit={(event) => void handleSubmit(save)(event)}
        >
          {serverError ? (
            <div className="auth-alert" role="alert">
              {serverError}
            </div>
          ) : null}
          <Input
            label="Name"
            error={errors.name?.message}
            {...nameRegistration}
            ref={(element) => {
              nameRegistration.ref(element);
              focusRef.current = element;
            }}
          />
          <Input
            label="Slug"
            error={errors.slug?.message}
            {...register('slug', { onChange: () => setSlugTouched(true) })}
          />
          <Input
            label="Category image URL (optional)"
            hint="Enter an existing image URL; this field does not upload files."
            error={errors.image?.message}
            {...register('image')}
          />
          <Select label="Parent category" {...register('parent')}>
            <option value="">No parent category</option>
            {parentOptions.map(({ category, depth }) => (
              <option key={category._id} value={category._id}>
                {'— '.repeat(depth)}
                {category.name}
              </option>
            ))}
          </Select>
          <Select label="Product form profile" {...register('formProfile')}>
            <option value="apparel">Apparel</option>
            <option value="drinkware">Drinkware</option>
            <option value="canvas_art">Canvas art</option>
            <option value="three_d_printed">3D-printed products</option>
            <option value="bags">Bags</option>
            <option value="general">General</option>
          </Select>
          <Textarea
            label="Description"
            rows={3}
            error={errors.description?.message}
            {...register('description')}
          />
          <Input
            label="Sort order"
            type="number"
            min={0}
            error={errors.sortOrder?.message}
            {...register('sortOrder', { valueAsNumber: true })}
          />
          <label className="admin-switch">
            <input
              type="checkbox"
              role="switch"
              checked={active}
              onChange={(event) =>
                setValue('isActive', event.target.checked, {
                  shouldDirty: true,
                })
              }
            />
            <span>
              <strong>Active</strong>
              <small>Active categories can appear in the storefront.</small>
            </span>
          </label>
          <div className="button-row">
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save category' : 'Create category'}
            </Button>
          </div>
          <p className="visually-hidden" aria-live="polite">
            {formSlug ? `Category slug: ${formSlug}` : ''}
          </p>
        </form>
      </Modal>
      <AdminConfirmDialog
        open={Boolean(deleting)}
        title="Delete category?"
        onClose={() => setDeleting(null)}
        onConfirm={() => void removeCategory()}
      >
        {`Delete “${deleting?.name ?? 'category'}”? The server will reject deletion if products or child categories remain; in that case, move them or deactivate this category instead.`}
      </AdminConfirmDialog>
    </>
  );
}

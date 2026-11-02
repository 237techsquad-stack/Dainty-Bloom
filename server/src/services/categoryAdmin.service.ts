import mongoose from 'mongoose';

import { Category, Product, type ICategory } from '../models';
import {
  DEFAULT_CATEGORY_FORM_PROFILE,
  type CategoryFormProfile,
} from '../constants/category';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { invalidateCatalogPublicCache } from '../utils/publicCache';
import { slugify } from '../utils/slugify';
import { logAuditEvent } from './audit.service';

export interface CategoryWriteInput {
  name?: string;
  slug?: string;
  description?: string;
  image?: string;
  formProfile?: CategoryFormProfile;
  parent?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export async function listAdminCategories() {
  const [categories, counts] = await Promise.all([
    Category.find().sort({ sortOrder: 1, name: 1 }).lean(),
    Product.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
  ]);
  const countByCategory = new Map(
    counts.map(({ _id, count }) => [_id.toString(), count]),
  );
  return categories.map((category) => ({
    ...category,
    formProfile: category.formProfile ?? DEFAULT_CATEGORY_FORM_PROFILE,
    productCount: countByCategory.get(category._id.toString()) ?? 0,
  }));
}

export async function createCategory(
  input: CategoryWriteInput,
  actor: IUser,
): Promise<ICategory> {
  const parent = await validateParent(input.parent);
  const slug = await uniqueCategorySlug(input.slug ?? input.name ?? '');
  let category: ICategory;
  try {
    category = await Category.create({
      ...input,
      slug,
      parent: parent?._id,
    });
  } catch (error) {
    throw mapCategoryDuplicateError(error);
  }

  invalidateCatalogPublicCache();
  await logAuditEvent({
    actor,
    action: 'category.create',
    targetType: 'Category',
    targetId: category._id.toString(),
    metadata: { changedFields: Object.keys(input) },
  });
  return category;
}

export async function updateCategory(
  id: string,
  input: CategoryWriteInput,
  actor: IUser,
): Promise<ICategory> {
  const category = await Category.findById(id);
  if (!category)
    throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');

  if (input.parent !== undefined) {
    const parent = await validateParent(input.parent);
    if (parent?._id.equals(category._id)) {
      throw new AppError(
        'A category cannot be its own parent',
        400,
        'CATEGORY_CYCLE',
      );
    }
    await ensureNoParentCycle(category._id, parent?._id);
    category.parent = parent?._id;
  }

  const updates = { ...input };
  delete updates.parent;
  if (updates.name !== undefined && updates.slug === undefined) {
    updates.slug = await uniqueCategorySlug(
      slugify(updates.name),
      category._id.toString(),
    );
  } else if (updates.slug !== undefined) {
    updates.slug = await uniqueCategorySlug(
      updates.slug,
      category._id.toString(),
    );
  }

  Object.assign(category, updates);
  try {
    await category.save();
  } catch (error) {
    throw mapCategoryDuplicateError(error);
  }
  invalidateCatalogPublicCache();
  await logAuditEvent({
    actor,
    action: 'category.update',
    targetType: 'Category',
    targetId: category._id.toString(),
    metadata: { changedFields: Object.keys(input) },
  });
  return category;
}

export async function deleteCategory(id: string, actor: IUser): Promise<void> {
  const category = await Category.findById(id);
  if (!category)
    throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');

  const [productCount, childCount] = await Promise.all([
    Product.countDocuments({ category: category._id }),
    Category.countDocuments({ parent: category._id }),
  ]);
  if (productCount > 0 || childCount > 0) {
    throw new AppError(
      'Category cannot be deleted while it has products or child categories',
      409,
      'CATEGORY_HAS_PRODUCTS',
      { productCount, childCount },
    );
  }

  await category.deleteOne();
  invalidateCatalogPublicCache();
  await logAuditEvent({
    actor,
    action: 'category.delete',
    targetType: 'Category',
    targetId: category._id.toString(),
    metadata: { slug: category.slug },
  });
}

async function validateParent(
  parentId?: string | null,
): Promise<ICategory | null> {
  if (!parentId) return null;
  if (!mongoose.isValidObjectId(parentId)) {
    throw new AppError(
      'Invalid parent category',
      400,
      'INVALID_CATEGORY_PARENT',
    );
  }
  const parent = await Category.findById(parentId);
  if (!parent) {
    throw new AppError(
      'Parent category not found',
      400,
      'INVALID_CATEGORY_PARENT',
    );
  }
  return parent;
}

async function ensureNoParentCycle(
  categoryId: mongoose.Types.ObjectId,
  parentId?: mongoose.Types.ObjectId,
): Promise<void> {
  let currentId = parentId;
  const visited = new Set<string>();
  while (currentId) {
    const key = currentId.toString();
    if (key === categoryId.toString() || visited.has(key)) {
      throw new AppError(
        'Category parent would create a cycle',
        400,
        'CATEGORY_CYCLE',
      );
    }
    visited.add(key);
    const current = await Category.findById(currentId)
      .select('parent')
      .lean<{ parent?: mongoose.Types.ObjectId } | null>();
    currentId = current?.parent;
  }
}

async function uniqueCategorySlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  const slugBase = slugify(base);
  if (!slugBase)
    throw new AppError('Category name cannot form a slug', 400, 'INVALID_SLUG');
  let candidate = slugBase;
  let suffix = 2;
  while (
    await Category.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    candidate = `${slugBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function mapCategoryDuplicateError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000 &&
    'keyPattern' in error &&
    typeof error.keyPattern === 'object' &&
    error.keyPattern !== null &&
    'slug' in error.keyPattern
  ) {
    return new AppError(
      'Category slug already exists',
      409,
      'SLUG_ALREADY_EXISTS',
    );
  }
  return error;
}

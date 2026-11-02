import { Category, Product } from '../models';
import { slugify } from '../utils/slugify';

const categories = [
  { name: 'T-Shirts', sortOrder: 0, formProfile: 'apparel' },
  { name: 'Mugs', sortOrder: 1, formProfile: 'drinkware' },
  { name: 'Paint-It-Yourself Canvas', sortOrder: 2, formProfile: 'canvas_art' },
  { name: '3D Printed Goods', sortOrder: 3, formProfile: 'three_d_printed' },
  { name: 'Hoodies', sortOrder: 4, formProfile: 'apparel' },
  {
    name: 'Phone Cases',
    description: 'Browse available phone cases from Dainty Bloom.',
    sortOrder: 5,
    formProfile: 'general',
  },
  {
    name: 'Toys',
    parentName: '3D Printed Goods',
    sortOrder: 0,
    formProfile: 'three_d_printed',
  },
  {
    name: 'Home Decor',
    parentName: '3D Printed Goods',
    sortOrder: 1,
    formProfile: 'three_d_printed',
  },
  {
    name: 'Lamps and Lighting',
    parentName: '3D Printed Goods',
    sortOrder: 2,
    formProfile: 'three_d_printed',
  },
  {
    name: 'Other 3D Prints',
    parentName: '3D Printed Goods',
    sortOrder: 3,
    formProfile: 'three_d_printed',
  },
] as const;

const legacyCategoryNames = [
  'Canvas',
  'Posters',
  'Tote Bags',
  'Signage',
];

export async function ensureBusinessCategories(
  deactivateUnused = false,
): Promise<void> {
  const ids = new Map<string, string>();
  for (const category of categories) {
    const slug = slugify(category.name);
    const parent = 'parentName' in category
      ? ids.get(slugify(category.parentName))
      : undefined;
    if ('parentName' in category && !parent) {
      throw new Error(`Parent category was not created: ${category.parentName}`);
    }
    const record = await Category.findOneAndUpdate(
      { slug },
      {
        $set: {
          isActive: true,
          sortOrder: category.sortOrder,
          ...(parent ? { parent } : {}),
          ...('description' in category
            ? { description: category.description }
            : {}),
        },
        $setOnInsert: {
          name: category.name,
          slug,
          formProfile: category.formProfile,
        },
      },
      { upsert: true, new: true, runValidators: true },
    ).select('_id');
    ids.set(slug, record._id.toString());
  }

  if (!deactivateUnused) return;
  for (const name of legacyCategoryNames) {
    const category = await Category.findOne({ slug: slugify(name) }).select(
      '_id',
    );
    if (!category) continue;
    const productCount = await Product.countDocuments({
      category: category._id,
    });
    if (productCount === 0) {
      await Category.updateOne(
        { _id: category._id },
        { $set: { isActive: false } },
      );
    }
  }
}

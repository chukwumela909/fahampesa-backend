import { Schema, model, type InferSchemaType } from 'mongoose'

const productSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    images: { type: [String], default: [] },
    barcode: { type: String, trim: true },
    sku: { type: String, trim: true },
    category: { type: String, trim: true },
    unitOfMeasure: { type: String, trim: true, default: 'unit' },
    isPerishable: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
)

productSchema.index({ businessAccountId: 1, isActive: 1 })
productSchema.index(
  { businessAccountId: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { barcode: { $type: 'string' }, isActive: true }
  }
)
productSchema.index(
  { businessAccountId: 1, sku: 1 },
  {
    unique: true,
    partialFilterExpression: { sku: { $type: 'string' }, isActive: true }
  }
)
productSchema.index({ name: 'text', barcode: 'text', sku: 'text', category: 'text' })

export type ProductDocument = InferSchemaType<typeof productSchema>
export const ProductModel = model('Product', productSchema)

export async function ensureProductIdentityIndexes() {
  let indexes: Awaited<ReturnType<typeof ProductModel.collection.indexes>>
  try {
    indexes = await ProductModel.collection.indexes()
  } catch (error) {
    if ((error as { codeName?: string }).codeName !== 'NamespaceNotFound') throw error
    await ProductModel.createIndexes()
    return
  }

  for (const index of indexes) {
    if (!index.name) continue
    if (shouldDropOptionalIdentityIndex(index, 'barcode') || shouldDropOptionalIdentityIndex(index, 'sku')) {
      await ProductModel.collection.dropIndex(index.name)
    }
  }

  await ProductModel.createIndexes()
}

function shouldDropOptionalIdentityIndex(index: { name?: string; partialFilterExpression?: unknown }, field: 'barcode' | 'sku') {
  if (index.name !== `businessAccountId_1_${field}_1`) return false

  const partialFilter = index.partialFilterExpression as Record<string, unknown> | undefined
  const fieldFilter = partialFilter?.[field] as Record<string, unknown> | undefined
  return partialFilter?.isActive !== true || fieldFilter?.$type !== 'string'
}

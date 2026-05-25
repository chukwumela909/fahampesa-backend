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
productSchema.index({ businessAccountId: 1, barcode: 1 }, { unique: true, sparse: true })
productSchema.index({ businessAccountId: 1, sku: 1 }, { unique: true, sparse: true })
productSchema.index({ name: 'text', barcode: 'text', sku: 'text', category: 'text' })

export type ProductDocument = InferSchemaType<typeof productSchema>
export const ProductModel = model('Product', productSchema)

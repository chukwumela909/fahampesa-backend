import { Schema, model, type InferSchemaType } from 'mongoose'

const inventoryItemSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    quantity: { type: Number, default: 0, min: 0 },
    reservedQuantity: { type: Number, default: 0, min: 0 },
    availableQuantity: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    averageCostPrice: { type: Number, default: 0, min: 0 },
    lastCostPrice: { type: Number, default: 0, min: 0 },
    costPrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    stockValue: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['in_stock', 'low_stock', 'out_of_stock', 'discontinued'],
      default: 'out_of_stock',
      index: true
    },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    expiryDate: { type: Date, default: null },
    batchNumber: { type: String, trim: true },
    binLocation: { type: String, trim: true },
    lastMovementAt: { type: Date, default: null },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
)

inventoryItemSchema.index({ businessAccountId: 1, branchId: 1, productId: 1 }, { unique: true })
inventoryItemSchema.index({ businessAccountId: 1, branchId: 1, quantity: 1 })
inventoryItemSchema.index({ businessAccountId: 1, branchId: 1, reorderLevel: 1 })

export type InventoryItemDocument = InferSchemaType<typeof inventoryItemSchema>
export const InventoryItemModel = model('InventoryItem', inventoryItemSchema)

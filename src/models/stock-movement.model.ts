import { Schema, model, type InferSchemaType } from 'mongoose'

const stockMovementSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    movementType: {
      type: String,
      enum: ['sale', 'purchase', 'transfer_out', 'transfer_in', 'adjustment', 'wastage', 'return', 'damage', 'theft', 'initial'],
      required: true
    },
    quantity: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: ['in', 'out'], required: true },
    previousQuantity: { type: Number, required: true, min: 0 },
    newQuantity: { type: Number, required: true, min: 0 },
    unitCostPrice: { type: Number, default: 0, min: 0 },
    totalValue: { type: Number, default: 0, min: 0 },
    referenceType: { type: String, trim: true },
    referenceId: { type: Schema.Types.ObjectId },
    reason: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

stockMovementSchema.index({ businessAccountId: 1, branchId: 1, productId: 1, createdAt: -1 })
stockMovementSchema.index({ businessAccountId: 1, referenceType: 1, referenceId: 1 })

export type StockMovementDocument = InferSchemaType<typeof stockMovementSchema>
export const StockMovementModel = model('StockMovement', stockMovementSchema)

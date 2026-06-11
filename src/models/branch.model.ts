import { Schema, model, type InferSchemaType } from 'mongoose'

const openingHoursSchema = new Schema(
  {
    dayOfWeek: {
      type: String,
      enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
      required: true
    },
    isOpen: { type: Boolean, required: true },
    openTime: { type: String },
    closeTime: { type: String },
    breakStart: { type: String },
    breakEnd: { type: String }
  },
  { _id: false }
)

const branchSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    name: { type: String, required: true, trim: true },
    location: {
      address: { type: String, required: true, trim: true },
      city: { type: String, trim: true },
      region: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
      landmark: { type: String, trim: true },
      directions: { type: String, trim: true }
    },
    contact: {
      phone: { type: String, trim: true },
      alternatePhone: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      whatsapp: { type: String, trim: true }
    },
    openingHours: { type: [openingHoursSchema], default: [] },
    managerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    branchCode: { type: String, trim: true },
    branchType: {
      type: String,
      enum: ['MAIN', 'BRANCH', 'OUTLET', 'WAREHOUSE', 'KIOSK'],
      default: 'BRANCH'
    },
    description: { type: String, trim: true },
    status: {
      type: String,
      enum: ['active', 'inactive', 'under_maintenance', 'temporarily_closed', 'disabled'],
      default: 'active',
      index: true
    },
    currency: { type: String, trim: true },
    taxSettings: {
      chargeTax: { type: Boolean, default: false },
      taxRate: { type: Number, default: 0 },
      taxNumber: { type: String, trim: true }
    },
    disabledAt: { type: Date, default: null },
    disabledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

branchSchema.index({ businessAccountId: 1, status: 1 })
branchSchema.index(
  { businessAccountId: 1, branchCode: 1 },
  { unique: true, partialFilterExpression: { branchCode: { $type: 'string', $gt: '' } } }
)

export type BranchDocument = InferSchemaType<typeof branchSchema>
export const BranchModel = model('Branch', branchSchema)

/**
 * Reconcile the (businessAccountId, branchCode) unique index.
 *
 * Legacy databases have this index as a plain unique index, which rejects a second
 * branch created without a branchCode (both store `branchCode: null` →
 * E11000 duplicate key). The schema now defines it as a PARTIAL unique index that
 * only applies to non-empty string codes, but Mongoose will not alter an existing
 * index whose name is unchanged — so the stale index must be dropped and recreated.
 * Safe to run on every startup (the branches collection is tiny).
 */
export async function ensureBranchIdentityIndexes() {
  let indexes: Awaited<ReturnType<typeof BranchModel.collection.indexes>>
  try {
    indexes = await BranchModel.collection.indexes()
  } catch (error) {
    if ((error as { codeName?: string }).codeName !== 'NamespaceNotFound') throw error
    await BranchModel.createIndexes()
    return
  }

  for (const index of indexes) {
    if (!index.name) continue
    if (shouldDropStaleBranchCodeIndex(index)) {
      await BranchModel.collection.dropIndex(index.name)
    }
  }

  await BranchModel.createIndexes()
}

function shouldDropStaleBranchCodeIndex(index: { name?: string; partialFilterExpression?: unknown }) {
  if (index.name !== 'businessAccountId_1_branchCode_1') return false
  const partialFilter = index.partialFilterExpression as Record<string, unknown> | undefined
  const fieldFilter = partialFilter?.branchCode as Record<string, unknown> | undefined
  // Drop unless it is already the partial index scoped to non-empty string codes.
  return fieldFilter?.$type !== 'string'
}

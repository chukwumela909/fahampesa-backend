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
branchSchema.index({ businessAccountId: 1, branchCode: 1 }, { unique: true, sparse: true })

export type BranchDocument = InferSchemaType<typeof branchSchema>
export const BranchModel = model('Branch', branchSchema)

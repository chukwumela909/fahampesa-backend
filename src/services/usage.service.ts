import { BranchModel } from '../models/branch.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { DebtorModel } from '../models/debtor.model.js'
import { ProductModel } from '../models/product.model.js'
import { SaleModel } from '../models/sale.model.js'
import { StaffInvitationModel } from '../models/staff-invitation.model.js'
import { SupplierModel } from '../models/supplier.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'

// Source-of-truth counts for plan-limit enforcement. Clients must not derive these from the
// legacy Firestore collections (now empty post-migration), which silently disabled free-tier caps.
export async function getBusinessUsage(context: RequestContext) {
  const businessAccountId = context.businessAccountId
  if (!businessAccountId || !context.role) {
    throw new ApiError(403, 'business_required', 'Business context required')
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [products, branches, staff, pendingInvitations, suppliers, debtors, salesToday] = await Promise.all([
    ProductModel.countDocuments({ businessAccountId, isActive: true }),
    BranchModel.countDocuments({ businessAccountId, status: { $ne: 'disabled' } }),
    BusinessMembershipModel.countDocuments({ businessAccountId, status: 'active', role: { $ne: 'owner' } }),
    StaffInvitationModel.countDocuments({ businessAccountId, status: 'pending' }),
    SupplierModel.countDocuments({ businessAccountId, status: 'active' }),
    DebtorModel.countDocuments({ businessAccountId, isActive: true }),
    SaleModel.countDocuments({ businessAccountId, createdAt: { $gte: startOfToday } })
  ])

  return {
    products,
    branches,
    // Staff count includes pending invitations so the seat is reserved the moment it's sent.
    staff: staff + pendingInvitations,
    suppliers,
    debtors,
    dailySales: salesToday
  }
}

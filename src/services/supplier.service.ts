import type { ClientSession, Types } from 'mongoose'
import { SupplierLedgerEntryModel } from '../models/supplier-ledger-entry.model.js'
import { SupplierPaymentModel } from '../models/supplier-payment.model.js'
import { SupplierModel } from '../models/supplier.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'

export interface SupplierInput {
  name: string
  contactPerson?: string
  phone?: string
  email?: string
  address?: string
  openingBalance?: number
  paymentTerms?: string
  notes?: string
}

export async function listSuppliers(context: RequestContext, branchId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const suppliers = await SupplierModel.find({ businessAccountId: context.businessAccountId, branchId, status: 'active' }).sort({ name: 1 })
  return suppliers.map(serializeSupplier)
}

export async function createSupplier(context: RequestContext, branchId: Types.ObjectId, input: SupplierInput) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const openingBalance = input.openingBalance ?? 0
    const [supplier] = await SupplierModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          branchId,
          ...input,
          openingBalance,
          currentBalance: openingBalance,
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    if (openingBalance > 0) {
      await createSupplierLedgerEntry(
        context,
        branchId,
        supplier._id,
        {
          entryType: 'opening_balance',
          debit: openingBalance,
          credit: 0,
          balanceAfter: openingBalance,
          notes: 'Opening balance'
        },
        activeSession
      )
    }

    return serializeSupplier(supplier)
  })
}

export async function getSupplier(context: RequestContext, branchId: Types.ObjectId, supplierId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const supplier = await findSupplier(context, branchId, supplierId)
  const ledger = await listSupplierLedger(context, branchId, supplierId)
  const payments = await listSupplierPayments(context, branchId, supplierId)
  return { ...serializeSupplier(supplier), ledger, payments }
}

export async function updateSupplier(context: RequestContext, branchId: Types.ObjectId, supplierId: Types.ObjectId, input: Partial<SupplierInput & { status: 'active' | 'inactive' }>) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const supplier = await SupplierModel.findOneAndUpdate(
    { _id: supplierId, businessAccountId: context.businessAccountId, branchId },
    { $set: input },
    { new: true }
  )
  if (!supplier) throw notFound('Supplier not found')
  return serializeSupplier(supplier)
}

export async function deleteSupplier(context: RequestContext, branchId: Types.ObjectId, supplierId: Types.ObjectId) {
  return updateSupplier(context, branchId, supplierId, { status: 'inactive' }).then(() => ({ deleted: true }))
}

export async function listSupplierLedger(context: RequestContext, branchId: Types.ObjectId, supplierId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  await findSupplier(context, branchId, supplierId)
  const entries = await SupplierLedgerEntryModel.find({ businessAccountId: context.businessAccountId, branchId, supplierId }).sort({ createdAt: -1 })
  return entries.map((entry) => normalizeMongo(entry.toObject({ versionKey: false })))
}

export async function listSupplierPayments(context: RequestContext, branchId: Types.ObjectId, supplierId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  await findSupplier(context, branchId, supplierId)
  const payments = await SupplierPaymentModel.find({ businessAccountId: context.businessAccountId, branchId, supplierId }).sort({ createdAt: -1 })
  return payments.map((payment) => normalizeMongo(payment.toObject({ versionKey: false })))
}

export async function recordSupplierPayment(
  context: RequestContext,
  branchId: Types.ObjectId,
  supplierId: Types.ObjectId,
  input: { purchaseOrderId?: Types.ObjectId; amount: number; paymentMethod: 'cash' | 'mpesa' | 'bank_transfer' | 'card' | 'cheque' | 'other'; reference?: string; notes?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const supplier = await findSupplier(context, branchId, supplierId, activeSession)
    if (input.amount > supplier.currentBalance) throw new ApiError(422, 'payment_exceeds_balance', 'Payment cannot exceed supplier balance')

    supplier.currentBalance -= input.amount
    supplier.totalPaid += input.amount
    await supplier.save(activeSession ? { session: activeSession } : undefined)

    const [payment] = await SupplierPaymentModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          branchId,
          supplierId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          reference: input.reference,
          notes: input.notes,
          recordedBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    const ledgerEntry = await createSupplierLedgerEntry(
      context,
      branchId,
      supplierId,
      {
        entryType: 'payment',
        debit: 0,
        credit: input.amount,
        balanceAfter: supplier.currentBalance,
        referenceType: 'supplier_payment',
        referenceId: payment._id,
        notes: input.notes
      },
      activeSession
    )

    return {
      supplier: serializeSupplier(supplier),
      payment: normalizeMongo(payment.toObject({ versionKey: false })),
      ledgerEntry: normalizeMongo(ledgerEntry.toObject({ versionKey: false }))
    }
  })
}

export async function addSupplierPurchaseBalance(
  context: RequestContext,
  branchId: Types.ObjectId,
  supplierId: Types.ObjectId,
  amount: number,
  referenceId: Types.ObjectId,
  session?: ClientSession
) {
  const supplier = await findSupplier(context, branchId, supplierId, session)
  supplier.currentBalance += amount
  supplier.totalPurchases += amount
  await supplier.save(session ? { session } : undefined)
  return createSupplierLedgerEntry(
    context,
    branchId,
    supplierId,
    {
      entryType: 'purchase',
      debit: amount,
      credit: 0,
      balanceAfter: supplier.currentBalance,
      referenceType: 'purchase_order',
      referenceId,
      notes: 'Purchase received'
    },
    session
  )
}

export async function createSupplierLedgerEntry(
  context: RequestContext,
  branchId: Types.ObjectId,
  supplierId: Types.ObjectId,
  input: {
    entryType: 'opening_balance' | 'purchase' | 'payment' | 'adjustment'
    debit: number
    credit: number
    balanceAfter: number
    referenceType?: string
    referenceId?: Types.ObjectId
    notes?: string
  },
  session?: ClientSession
) {
  const [entry] = await SupplierLedgerEntryModel.create(
    [
      {
        businessAccountId: context.businessAccountId,
        branchId,
        supplierId,
        ...input,
        createdBy: context.userId
      }
    ],
    session ? { session } : {}
  )
  return entry
}

async function findSupplier(context: RequestContext, branchId: Types.ObjectId, supplierId: Types.ObjectId, session?: ClientSession) {
  const supplier = await SupplierModel.findOne({
    _id: supplierId,
    businessAccountId: context.businessAccountId,
    branchId,
    status: 'active'
  }).session(session ?? null)
  if (!supplier) throw notFound('Supplier not found')
  return supplier
}

function serializeSupplier(supplier: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(supplier.toObject({ versionKey: false })) as Record<string, unknown>
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') throw new ApiError(403, 'manager_required', 'Only owners and managers can manage suppliers')
}

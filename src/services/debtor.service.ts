import type { ClientSession, Types } from 'mongoose'
import { DebtorPaymentModel } from '../models/debtor-payment.model.js'
import { DebtorModel } from '../models/debtor.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'

export interface DebtorInput {
  name: string
  phone?: string
  email?: string
  creditLimit?: number
  dueDate?: Date | null
}

export async function listDebtors(context: RequestContext, branchId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const debtors = await DebtorModel.find({
    businessAccountId: context.businessAccountId,
    branchId,
    isActive: true
  }).sort({ name: 1 })
  return debtors.map(serializeDebtor)
}

export async function createDebtor(context: RequestContext, branchId: Types.ObjectId, input: DebtorInput) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const debtor = await DebtorModel.create({
    businessAccountId: context.businessAccountId,
    branchId,
    ...input,
    creditLimit: input.creditLimit ?? 0,
    createdBy: context.userId
  })
  return serializeDebtor(debtor)
}

export async function getDebtor(context: RequestContext, branchId: Types.ObjectId, debtorId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const debtor = await DebtorModel.findOne({
    _id: debtorId,
    businessAccountId: context.businessAccountId,
    branchId,
    isActive: true
  })
  if (!debtor) throw notFound('Debtor not found')

  const payments = await DebtorPaymentModel.find({
    businessAccountId: context.businessAccountId,
    branchId,
    debtorId
  }).sort({ createdAt: -1 })

  return {
    ...serializeDebtor(debtor),
    payments: payments.map((payment) => normalizeMongo(payment.toObject({ versionKey: false })))
  }
}

export async function updateDebtor(
  context: RequestContext,
  branchId: Types.ObjectId,
  debtorId: Types.ObjectId,
  input: Partial<DebtorInput & { isActive: boolean }>
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const debtor = await DebtorModel.findOneAndUpdate(
    { _id: debtorId, businessAccountId: context.businessAccountId, branchId },
    { $set: input },
    { new: true }
  )
  if (!debtor) throw notFound('Debtor not found')
  return serializeDebtor(debtor)
}

export async function recordDebtorPayment(
  context: RequestContext,
  branchId: Types.ObjectId,
  debtorId: Types.ObjectId,
  input: { amount: number; paymentMethod: 'cash' | 'mpesa' | 'bank_transfer' | 'card' | 'cheque' | 'other'; reference?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const debtor = await DebtorModel.findOne({
      _id: debtorId,
      businessAccountId: context.businessAccountId,
      branchId,
      isActive: true
    }).session(activeSession ?? null)
    if (!debtor) throw notFound('Debtor not found')
    if (input.amount > debtor.currentDebt) {
      throw new ApiError(422, 'payment_exceeds_debt', 'Payment amount cannot exceed current debt')
    }

    debtor.currentDebt -= input.amount
    debtor.totalPayments += input.amount
    debtor.paymentStatus = getPaymentStatus(debtor.currentDebt, debtor.dueDate)
    await debtor.save(activeSession ? { session: activeSession } : undefined)

    const [payment] = await DebtorPaymentModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          branchId,
          debtorId,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          reference: input.reference,
          outstandingBalance: debtor.currentDebt,
          recordedBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    return {
      debtor: serializeDebtor(debtor),
      payment: normalizeMongo(payment.toObject({ versionKey: false }))
    }
  })
}

export async function addDebtorPurchase(
  context: RequestContext,
  branchId: Types.ObjectId,
  debtorId: Types.ObjectId,
  amount: number,
  session?: ClientSession
) {
  const activeSession = session?.inTransaction() ? session : undefined
  const debtor = await DebtorModel.findOne({
    _id: debtorId,
    businessAccountId: context.businessAccountId,
    branchId,
    isActive: true
  }).session(activeSession ?? null)
  if (!debtor) throw notFound('Debtor not found')

  const nextDebt = debtor.currentDebt + amount
  if (debtor.creditLimit > 0 && nextDebt > debtor.creditLimit) {
    throw new ApiError(409, 'credit_limit_exceeded', 'Credit sale would exceed debtor credit limit')
  }

  debtor.currentDebt = nextDebt
  debtor.totalPurchases += amount
  debtor.paymentStatus = getPaymentStatus(debtor.currentDebt, debtor.dueDate)
  await debtor.save(activeSession ? { session: activeSession } : undefined)
  return debtor
}

export async function reverseDebtorPurchase(
  context: RequestContext,
  branchId: Types.ObjectId,
  debtorId: Types.ObjectId,
  amount: number,
  session?: ClientSession
) {
  const activeSession = session?.inTransaction() ? session : undefined
  const debtor = await DebtorModel.findOne({
    _id: debtorId,
    businessAccountId: context.businessAccountId,
    branchId,
    isActive: true
  }).session(activeSession ?? null)
  // Debtor may have been deactivated/removed; nothing to reverse
  if (!debtor) return null

  debtor.currentDebt = Math.max(debtor.currentDebt - amount, 0)
  debtor.totalPurchases = Math.max(debtor.totalPurchases - amount, 0)
  debtor.paymentStatus = getPaymentStatus(debtor.currentDebt, debtor.dueDate)
  await debtor.save(activeSession ? { session: activeSession } : undefined)
  return debtor
}

function serializeDebtor(debtor: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(debtor.toObject({ versionKey: false })) as Record<string, unknown>
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can manage debtors')
  }
}

function getPaymentStatus(currentDebt: number, dueDate?: Date | null) {
  if (currentDebt <= 0) return 'clear'
  if (dueDate && dueDate.getTime() < Date.now()) return 'overdue'
  return 'outstanding'
}

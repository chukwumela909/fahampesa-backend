import type { Types } from 'mongoose'
import { ExpenseModel } from '../models/expense.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { getBranchForContext } from './branch.service.js'

export interface ExpenseInput {
  amount: number
  category: string
  description?: string
  paymentMethod: 'cash' | 'mpesa' | 'bank_transfer' | 'card' | 'cheque' | 'other'
  vendor?: string
  receiptNumber?: string
  attachmentUrl?: string
  date?: Date
}

export async function listExpenses(context: RequestContext, branchId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const expenses = await ExpenseModel.find({
    businessAccountId: context.businessAccountId,
    branchId,
    isDeleted: false
  }).sort({ date: -1, createdAt: -1 })
  return expenses.map(serializeExpense)
}

export async function createExpense(context: RequestContext, branchId: Types.ObjectId, input: ExpenseInput) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const expense = await ExpenseModel.create({
    businessAccountId: context.businessAccountId,
    branchId,
    ...input,
    date: input.date ?? new Date(),
    createdBy: context.userId
  })
  return serializeExpense(expense)
}

export async function updateExpense(context: RequestContext, branchId: Types.ObjectId, expenseId: Types.ObjectId, input: Partial<ExpenseInput>) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const expense = await ExpenseModel.findOneAndUpdate(
    { _id: expenseId, businessAccountId: context.businessAccountId, branchId, isDeleted: false },
    { $set: input },
    { new: true }
  )
  if (!expense) throw notFound('Expense not found')
  return serializeExpense(expense)
}

export async function deleteExpense(context: RequestContext, branchId: Types.ObjectId, expenseId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const expense = await ExpenseModel.findOneAndUpdate(
    { _id: expenseId, businessAccountId: context.businessAccountId, branchId, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: context.userId } },
    { new: true }
  )
  if (!expense) throw notFound('Expense not found')
  return { deleted: true }
}

function serializeExpense(expense: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(expense.toObject({ versionKey: false })) as Record<string, unknown>
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can manage expenses')
  }
}

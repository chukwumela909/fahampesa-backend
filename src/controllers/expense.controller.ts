import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createExpenseSchema, updateExpenseSchema } from '../validators/expense.validator.js'
import { createExpense, deleteExpense, listExpenses, updateExpense } from '../services/expense.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const expenses = await listExpenses(req.context!, branchId)
  res.json({ data: expenses })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = createExpenseSchema.parse(req.body)
  const expense = await createExpense(req.context!, branchId, body)
  res.status(201).json({ data: expense })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const expenseId = toObjectId(objectIdSchema.parse(req.params.expenseId))
  const body = updateExpenseSchema.parse(req.body)
  const expense = await updateExpense(req.context!, branchId, expenseId, body)
  res.json({ data: expense })
})

export const remove = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const expenseId = toObjectId(objectIdSchema.parse(req.params.expenseId))
  const result = await deleteExpense(req.context!, branchId, expenseId)
  res.json({ data: result })
})

import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { toObjectId } from '../validators/common.js'
import { reportQuerySchema } from '../validators/report.validator.js'
import type { ReportScopeInput } from '../services/report.service.js'
import {
  branchPerformanceReport,
  dashboardReport,
  expensesReport,
  inventoryValuationReport,
  lowStockReport,
  salesReport,
  supplierReport
} from '../services/report.service.js'

export const dashboard = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await dashboardReport(req.context!, parseScope(req.query)) })
})

export const sales = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await salesReport(req.context!, parseScope(req.query)) })
})

export const inventoryValuation = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await inventoryValuationReport(req.context!, parseScope(req.query)) })
})

export const lowStock = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await lowStockReport(req.context!, parseScope(req.query)) })
})

export const suppliers = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await supplierReport(req.context!, parseScope(req.query)) })
})

export const expenses = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await expensesReport(req.context!, parseScope(req.query)) })
})

export const branchPerformance = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await branchPerformanceReport(req.context!, parseScope(req.query)) })
})

export const branchDashboard = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await dashboardReport(req.context!, { branchId: toObjectId(req.params.branchId) }) })
})

function parseScope(query: unknown): ReportScopeInput {
  const parsed = reportQuerySchema.parse(query)
  return {
    ...parsed,
    branchId: parsed.branchId === 'all' ? 'all' : parsed.branchId ? toObjectId(parsed.branchId) : undefined
  }
}

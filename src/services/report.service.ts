import type { Types } from 'mongoose'
import { AlertModel } from '../models/alert.model.js'
import { BranchModel } from '../models/branch.model.js'
import { ExpenseModel } from '../models/expense.model.js'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { SaleModel } from '../models/sale.model.js'
import { RefundModel } from '../models/refund.model.js'
import { SupplierModel } from '../models/supplier.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'

export interface ReportScopeInput {
  branchId?: Types.ObjectId | 'all'
  from?: Date
  to?: Date
}

export async function dashboardReport(context: RequestContext, input: ReportScopeInput) {
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const dateRange = buildDateRange(input)
  // Refunded sales are excluded from revenue/profit; refunds are surfaced separately
  const saleQuery = { businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, isDeleted: false, isRefunded: { $ne: true }, ...dateRange.createdAt }
  const expenseQuery = { businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, isDeleted: false, ...dateRange.date }
  const refundQuery = { businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, ...dateRange.createdAt }

  const [sales, expenses, inventoryItems, lowStockAlerts, suppliers, refunds] = await Promise.all([
    SaleModel.find(saleQuery),
    ExpenseModel.find(expenseQuery),
    InventoryItemModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, status: { $ne: 'discontinued' } }),
    AlertModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, alertType: 'low_stock', status: 'active' }),
    SupplierModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, status: 'active' }),
    RefundModel.find(refundQuery)
  ])

  const data: Record<string, unknown> = {
    branchIds: branchIds.map((id) => id.toString()),
    salesCount: sales.length,
    totalSales: sum(sales, 'totalAmount'),
    refundsCount: refunds.length,
    totalRefunds: sum(refunds, 'amount'),
    expensesCount: expenses.length,
    inventoryItemCount: inventoryItems.length,
    lowStockCount: lowStockAlerts.length
  }

  if (context.role !== 'cashier') {
    data.totalCost = sum(sales, 'totalCost')
    data.totalProfit = sum(sales, 'profit')
    data.totalExpenses = sum(expenses, 'amount')
    data.inventoryValue = sum(inventoryItems, 'stockValue')
    data.supplierBalance = sum(suppliers, 'currentBalance')
  }

  return data
}

export async function salesReport(context: RequestContext, input: ReportScopeInput) {
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const dateRange = buildDateRange(input)
  const [sales, refunds] = await Promise.all([
    SaleModel.find({
      businessAccountId: context.businessAccountId,
      branchId: { $in: branchIds },
      isDeleted: false,
      isRefunded: { $ne: true },
      ...dateRange.createdAt
    }).sort({ createdAt: -1 }),
    RefundModel.find({
      businessAccountId: context.businessAccountId,
      branchId: { $in: branchIds },
      ...dateRange.createdAt
    })
  ])

  const data: Record<string, unknown> = {
    branchIds: branchIds.map((id) => id.toString()),
    count: sales.length,
    totalSales: sum(sales, 'totalAmount'),
    refundsCount: refunds.length,
    totalRefunds: sum(refunds, 'amount'),
    byPaymentMethod: groupSum(sales, 'paymentMethod', 'totalAmount')
  }

  if (context.role !== 'cashier') {
    data.totalCost = sum(sales, 'totalCost')
    data.totalProfit = sum(sales, 'profit')
  }

  return data
}

export async function inventoryValuationReport(context: RequestContext, input: ReportScopeInput) {
  denyCashierFinancialReport(context)
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const items = await InventoryItemModel.find({
    businessAccountId: context.businessAccountId,
    branchId: { $in: branchIds },
    status: { $ne: 'discontinued' }
  })
  return {
    branchIds: branchIds.map((id) => id.toString()),
    itemCount: items.length,
    totalQuantity: sum(items, 'quantity'),
    totalStockValue: sum(items, 'stockValue'),
    byBranch: branchTotals(items, 'stockValue')
  }
}

export async function lowStockReport(context: RequestContext, input: ReportScopeInput) {
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const alerts = await AlertModel.find({
    businessAccountId: context.businessAccountId,
    branchId: { $in: branchIds },
    alertType: 'low_stock',
    status: 'active'
  }).sort({ updatedAt: -1 })
  return {
    branchIds: branchIds.map((id) => id.toString()),
    count: alerts.length,
    alerts: alerts.map((alert) => ({
      id: alert._id.toString(),
      branchId: alert.branchId.toString(),
      productId: alert.productId?.toString(),
      severity: alert.severity,
      message: alert.message,
      metadata: alert.metadata
    }))
  }
}

export async function supplierReport(context: RequestContext, input: ReportScopeInput) {
  denyCashierFinancialReport(context)
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const suppliers = await SupplierModel.find({
    businessAccountId: context.businessAccountId,
    branchId: { $in: branchIds },
    status: 'active'
  })
  return {
    branchIds: branchIds.map((id) => id.toString()),
    supplierCount: suppliers.length,
    totalPurchases: sum(suppliers, 'totalPurchases'),
    totalPaid: sum(suppliers, 'totalPaid'),
    outstandingBalance: sum(suppliers, 'currentBalance'),
    byBranch: branchTotals(suppliers, 'currentBalance')
  }
}

export async function expensesReport(context: RequestContext, input: ReportScopeInput) {
  denyCashierFinancialReport(context)
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const dateRange = buildDateRange(input)
  const expenses = await ExpenseModel.find({
    businessAccountId: context.businessAccountId,
    branchId: { $in: branchIds },
    isDeleted: false,
    ...dateRange.date
  })
  return {
    branchIds: branchIds.map((id) => id.toString()),
    count: expenses.length,
    totalExpenses: sum(expenses, 'amount'),
    byCategory: groupSum(expenses, 'category', 'amount'),
    byPaymentMethod: groupSum(expenses, 'paymentMethod', 'amount')
  }
}

export async function branchPerformanceReport(context: RequestContext, input: ReportScopeInput) {
  denyCashierFinancialReport(context)
  const branchIds = await resolveReportBranchIds(context, input.branchId)
  const dateRange = buildDateRange(input)
  const [branches, sales, expenses, inventoryItems, suppliers] = await Promise.all([
    BranchModel.find({ _id: { $in: branchIds }, businessAccountId: context.businessAccountId }),
    SaleModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, isDeleted: false, isRefunded: { $ne: true }, ...dateRange.createdAt }),
    ExpenseModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, isDeleted: false, ...dateRange.date }),
    InventoryItemModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, status: { $ne: 'discontinued' } }),
    SupplierModel.find({ businessAccountId: context.businessAccountId, branchId: { $in: branchIds }, status: 'active' })
  ])

  return branches.map((branch) => {
    const id = branch._id.toString()
    const branchSales = sales.filter((sale) => sale.branchId.toString() === id)
    const branchExpenses = expenses.filter((expense) => expense.branchId.toString() === id)
    const branchInventory = inventoryItems.filter((item) => item.branchId.toString() === id)
    const branchSuppliers = suppliers.filter((supplier) => supplier.branchId.toString() === id)
    return {
      branchId: id,
      branchName: branch.name,
      salesCount: branchSales.length,
      totalSales: sum(branchSales, 'totalAmount'),
      totalProfit: sum(branchSales, 'profit'),
      totalExpenses: sum(branchExpenses, 'amount'),
      inventoryValue: sum(branchInventory, 'stockValue'),
      supplierBalance: sum(branchSuppliers, 'currentBalance')
    }
  })
}

export async function resolveReportBranchIds(context: RequestContext, branchId?: Types.ObjectId | 'all') {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')

  if (branchId === 'all' || !branchId) {
    if (context.role === 'owner') {
      const branches = await BranchModel.find({ businessAccountId: context.businessAccountId, status: { $ne: 'disabled' } }).select('_id')
      return branches.map((branch) => branch._id)
    }
    if (branchId === 'all') throw new ApiError(403, 'owner_required', 'Only owners can request all-branch reports')
    return context.assignedBranchIds
  }

  if (context.role !== 'owner' && !context.assignedBranchIds.some((assigned) => assigned.equals(branchId))) {
    throw new ApiError(403, 'branch_forbidden', 'You do not have access to this branch')
  }

  const branch = await BranchModel.findOne({ _id: branchId, businessAccountId: context.businessAccountId, status: { $ne: 'disabled' } }).select('_id')
  if (!branch) throw new ApiError(404, 'not_found', 'Branch not found')
  return [branch._id]
}

function denyCashierFinancialReport(context: RequestContext) {
  if (context.role === 'cashier') throw new ApiError(403, 'financial_report_forbidden', 'Cashiers cannot access financial valuation reports')
}

function buildDateRange(input: ReportScopeInput) {
  const range: Record<string, Date> = {}
  if (input.from) range.$gte = input.from
  if (input.to) range.$lte = input.to
  if (Object.keys(range).length === 0) return { createdAt: {}, date: {} }
  return { createdAt: { createdAt: range }, date: { date: range } }
}

function sum<T>(items: T[], field: keyof T) {
  return items.reduce((total, item) => total + Number(item[field] ?? 0), 0)
}

function groupSum<T>(items: T[], groupField: keyof T, sumField: keyof T) {
  const grouped: Record<string, number> = {}
  for (const item of items) {
    const key = String(item[groupField] ?? 'unknown')
    grouped[key] = (grouped[key] ?? 0) + Number(item[sumField] ?? 0)
  }
  return grouped
}

function branchTotals<T extends { branchId: Types.ObjectId }>(items: T[], field: keyof T) {
  const grouped: Record<string, number> = {}
  for (const item of items) {
    const key = item.branchId.toString()
    grouped[key] = (grouped[key] ?? 0) + Number(item[field] ?? 0)
  }
  return grouped
}

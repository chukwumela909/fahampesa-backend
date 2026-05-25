import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { serializeDocument } from '../utils/serialize.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createBranchSchema, updateBranchSchema } from '../validators/branch.validator.js'
import { createBranch, disableBranch, enableBranch, getBranchForContext, listBranches, updateBranch } from '../services/branch.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branches = await listBranches(req.context!)
  res.json({ data: branches.map(serializeDocument) })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = createBranchSchema.parse(req.body)
  const branch = await createBranch(req.context!, body, {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.status(201).json({ data: serializeDocument(branch) })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const branch = await getBranchForContext(req.context!, branchId)
  res.json({ data: serializeDocument(branch) })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = updateBranchSchema.parse(req.body)
  const branch = await updateBranch(req.context!, branchId, body, {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.json({ data: serializeDocument(branch) })
})

export const disable = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const branch = await disableBranch(req.context!, branchId, {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.json({ data: serializeDocument(branch) })
})

export const enable = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const branch = await enableBranch(req.context!, branchId, {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.json({ data: serializeDocument(branch) })
})

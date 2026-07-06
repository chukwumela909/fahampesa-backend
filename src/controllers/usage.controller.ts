import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { getBusinessUsage } from '../services/usage.service.js'

export const usage = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await getBusinessUsage(req.context!) })
})

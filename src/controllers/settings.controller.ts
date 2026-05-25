import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { updateSettingsSchema } from '../validators/settings.validator.js'
import { getSettings, updateSettings } from '../services/settings.service.js'

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await getSettings(req.context!) })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = updateSettingsSchema.parse(req.body)
  res.json({ data: await updateSettings(req.context!, body) })
})

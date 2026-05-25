import { Types } from 'mongoose'
import { z } from 'zod'

export const objectIdSchema = z.string().refine((value) => Types.ObjectId.isValid(value), {
  message: 'Invalid object id'
})

export function toObjectId(value: string) {
  return new Types.ObjectId(value)
}

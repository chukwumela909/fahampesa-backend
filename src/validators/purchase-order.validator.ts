import { z } from 'zod'
import { objectIdSchema } from './common.js'

const purchaseOrderItemSchema = z.object({
  productId: objectIdSchema,
  quantityOrdered: z.number().positive(),
  unitCostPrice: z.number().min(0)
})

export const createPurchaseOrderSchema = z.object({
  supplierId: objectIdSchema,
  items: z.array(purchaseOrderItemSchema).min(1),
  taxAmount: z.number().min(0).optional(),
  shippingCost: z.number().min(0).optional(),
  amountPaid: z.number().min(0).optional(),
  paymentTerms: z.string().trim().optional(),
  expectedDeliveryDate: z.coerce.date().nullable().optional(),
  // When true, the purchase is created and immediately received so stock increases at once.
  receiveImmediately: z.boolean().optional()
})

export const receivePurchaseOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantityReceived: z.number().positive()
      })
    )
    .min(1)
})

export type CreatePurchaseOrderBody = z.infer<typeof createPurchaseOrderSchema>

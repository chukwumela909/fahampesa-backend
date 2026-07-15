import type { ClientSession, Model, Types } from 'mongoose'
import { CounterModel } from '../models/counter.model.js'

/**
 * Atomically claim the next number in a per-business sequence.
 *
 * The first call for a (business, key) pair seeds the counter from the highest
 * existing document number (NOT the document count), so numbering continues
 * correctly for existing businesses and never reuses numbers freed by deletes.
 */
export async function nextDocumentNumber(
  businessAccountId: Types.ObjectId,
  key: string,
  prefix: string,
  numberField: string,
  sourceModel: Model<never>,
  session?: ClientSession
) {
  const activeSession = session?.inTransaction() ? session : undefined

  let counter = await CounterModel.findOneAndUpdate(
    { businessAccountId, key },
    { $inc: { seq: 1 } },
    { new: true }
  ).session(activeSession ?? null)

  if (!counter) {
    const seed = await highestExistingNumber(businessAccountId, prefix, numberField, sourceModel, activeSession)
    try {
      await CounterModel.create([{ businessAccountId, key, seq: seed }], activeSession ? { session: activeSession } : {})
    } catch {
      // Lost the creation race to a concurrent request — the $inc below still works.
    }
    counter = await CounterModel.findOneAndUpdate(
      { businessAccountId, key },
      { $inc: { seq: 1 } },
      { new: true }
    ).session(activeSession ?? null)
  }

  return `${prefix}${String(counter!.seq).padStart(6, '0')}`
}

async function highestExistingNumber(
  businessAccountId: Types.ObjectId,
  prefix: string,
  numberField: string,
  sourceModel: Model<never>,
  session?: ClientSession
) {
  // Zero-padded numbers sort correctly as strings, so the lexicographic max is the numeric max.
  const latest = await sourceModel
    .findOne({ businessAccountId } as never)
    .sort({ [numberField]: -1 })
    .select(numberField)
    .session(session ?? null)
    .lean<Record<string, unknown> | null>()
  const raw = latest?.[numberField]
  if (typeof raw !== 'string' || !raw.startsWith(prefix)) return 0
  const parsed = Number.parseInt(raw.slice(prefix.length), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

import type { Document } from 'mongoose'

export function serializeDocument<T extends Document>(doc: T) {
  const value = doc.toObject({ versionKey: false })
  return normalizeMongo(value)
}

export function normalizeMongo(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeMongo)
  if (!value || typeof value !== 'object') return value

  if (isObjectIdLike(value)) return value.toString()
  if (value instanceof Date) return value.toISOString()

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    if (key === '_id') {
      output.id = normalizeMongo(child)
    } else {
      output[key] = normalizeMongo(child)
    }
  }
  return output
}

function isObjectIdLike(value: object): value is { toString(): string; _bsontype: string } {
  return '_bsontype' in value && typeof (value as { _bsontype?: unknown })._bsontype === 'string'
}

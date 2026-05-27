import { describe, expect, it } from 'vitest'
import { normalizeFirebasePrivateKey } from '../src/config/firebase.js'

const pem = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n'
const escapedPem = '-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----\\n'

describe('normalizeFirebasePrivateKey', () => {
  it('keeps valid PEM newlines intact', () => {
    expect(normalizeFirebasePrivateKey(pem)).toBe(pem.trim())
  })

  it('converts escaped newline sequences to PEM newlines', () => {
    expect(normalizeFirebasePrivateKey(escapedPem)).toBe(pem.trim())
  })

  it('accepts a JSON-escaped private key string', () => {
    expect(normalizeFirebasePrivateKey(JSON.stringify(escapedPem))).toBe(pem.trim())
  })

  it('accepts a base64-encoded PEM', () => {
    const encodedPem = Buffer.from(pem, 'utf8').toString('base64')

    expect(normalizeFirebasePrivateKey(encodedPem)).toBe(pem.trim())
  })

  it('accepts a quoted base64-encoded PEM', () => {
    const encodedPem = Buffer.from(pem, 'utf8').toString('base64')

    expect(normalizeFirebasePrivateKey(`"${encodedPem}"`)).toBe(pem.trim())
  })

  it('accepts a service account JSON object with private_key', () => {
    const serviceAccountJson = JSON.stringify({ private_key: escapedPem })

    expect(normalizeFirebasePrivateKey(serviceAccountJson)).toBe(pem.trim())
  })

  it('throws an actionable error for invalid private key values', () => {
    expect(() => normalizeFirebasePrivateKey('not-a-private-key')).toThrow('FIREBASE_PRIVATE_KEY must be a valid PEM')
  })
})

import { createHmac, timingSafeEqual } from 'node:crypto'

export function signMarkToken(parlayId: string, action: 'bet' | 'skip', secret: string): string {
  const h = createHmac('sha256', secret)
  h.update(`${parlayId}:${action}`)
  return h.digest('hex')
}

export function verifyMarkToken(parlayId: string, action: 'bet' | 'skip', token: string, secret: string): boolean {
  const expected = signMarkToken(parlayId, action, secret)
  if (expected.length !== token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))
  } catch {
    return false
  }
}

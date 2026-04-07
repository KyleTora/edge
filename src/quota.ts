export interface QuotaSnapshot {
  used: number
  remaining: number
  lastCallCost: number
}

let latest: QuotaSnapshot | null = null

export function recordQuotaResponse(headers: Record<string, string | undefined> | Headers | undefined): void {
  if (!headers) return
  const get = (key: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(key) ?? undefined
    return headers[key]
  }
  const used = get('x-requests-used')
  const remaining = get('x-requests-remaining')
  const last = get('x-requests-last')
  if (used === undefined || remaining === undefined || last === undefined) return
  latest = {
    used: Number(used),
    remaining: Number(remaining),
    lastCallCost: Number(last),
  }
}

export function getLastQuotaSnapshot(): QuotaSnapshot | null {
  return latest
}

export function resetQuotaState(): void {
  latest = null
}

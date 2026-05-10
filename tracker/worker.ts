// tracker/worker.ts
export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  SIGNING_SECRET: string
}

async function verifyToken(parlayId: string, action: string, token: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${parlayId}:${action}`))
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (expected.length !== token.length) return false
  // constant-time compare
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:24px">${body}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html;charset=utf-8' },
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname !== '/mark') return html('<h1>Not found</h1>', 404)
    const parlayId = url.searchParams.get('p')
    const action = url.searchParams.get('a')
    const token = url.searchParams.get('t')
    if (!parlayId || (action !== 'bet' && action !== 'skip') || !token) {
      return html('<h1>Bad request</h1>', 400)
    }
    if (!(await verifyToken(parlayId, action, token, env.SIGNING_SECRET))) {
      return html('<h1>Invalid signature</h1>', 400)
    }
    const status = action === 'bet' ? 'bet' : 'skipped'
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/edge_parlays?id=eq.${parlayId}`, {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        'prefer': 'return=representation',
      },
      body: JSON.stringify({ status, bet_marked_at: new Date().toISOString() }),
    })
    if (!res.ok) return html(`<h1>DB error</h1><p>${res.status}</p>`, 502)
    const label = status === 'bet' ? 'Locked in. Good luck.' : 'Got it — skipping today. Streak unaffected.'
    return html(`<h1>${label}</h1><p>You can close this tab.</p>`)
  },
}

import { describe, it, expect, vi } from 'vitest'
import { sendReportEmail, type ResendLike } from '../../src/email/send.js'

function makeFakeClient(): { client: ResendLike; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  const client: ResendLike = {
    emails: {
      send: vi.fn(async (payload: Record<string, unknown>) => {
        calls.push(payload)
        return { data: { id: 'fake-id-123' }, error: null }
      }),
    },
  }
  return { client, calls }
}

describe('sendReportEmail', () => {
  it('includes attachments when csvFilename and csvContent are provided', async () => {
    const { client, calls } = makeFakeClient()
    const result = await sendReportEmail({
      apiKey: 'unused',
      from: 'edge <a@b>',
      to: 'me@example.com',
      subject: 'subj',
      html: '<p>hi</p>',
      csvFilename: 'picks.csv',
      csvContent: 'a,b\n1,2\n',
      client,
    })
    expect(result.id).toBe('fake-id-123')
    expect(calls).toHaveLength(1)
    const payload = calls[0]!
    expect(payload.attachments).toBeDefined()
    expect((payload.attachments as Array<{ filename: string }>)[0]?.filename).toBe('picks.csv')
  })

  it('omits attachments entirely when csv params are absent', async () => {
    const { client, calls } = makeFakeClient()
    const result = await sendReportEmail({
      apiKey: 'unused',
      from: 'edge <a@b>',
      to: 'me@example.com',
      subject: 'subj',
      html: '<p>hi</p>',
      client,
    })
    expect(result.id).toBe('fake-id-123')
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toHaveProperty('attachments')
  })

  it('throws when Resend returns an error', async () => {
    const client: ResendLike = {
      emails: {
        send: vi.fn(async () => ({ data: null, error: { message: 'rate limited' } })),
      },
    }
    await expect(
      sendReportEmail({
        apiKey: 'unused',
        from: 'edge <a@b>',
        to: 'me@example.com',
        subject: 'subj',
        html: '<p>hi</p>',
        client,
      })
    ).rejects.toThrow(/rate limited/)
  })
})

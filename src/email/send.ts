import { Resend } from 'resend'

/**
 * Minimal interface over the Resend client we depend on. Lets tests inject a
 * fake without standing up the network. Production paths use the real Resend
 * client (created from `apiKey` when `client` is not provided).
 */
export interface ResendLike {
  emails: {
    send: (payload: Record<string, unknown>) => Promise<{
      data: { id: string } | null
      error: { message: string } | null
    }>
  }
}

export interface SendEmailInput {
  apiKey: string
  from: string         // e.g. "edge <onboarding@resend.dev>"
  to: string           // recipient address
  subject: string
  html: string
  /** Optional CSV attachment. Both fields must be provided together. */
  csvFilename?: string
  csvContent?: string
  /** Optional injection point for tests. Production omits and a real Resend client is built from apiKey. */
  client?: ResendLike
}

export interface SendEmailResult {
  id: string
}

export async function sendReportEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client: ResendLike = input.client ?? (new Resend(input.apiKey) as unknown as ResendLike)

  const payload: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  }
  if (input.csvFilename && input.csvContent) {
    payload.attachments = [
      {
        filename: input.csvFilename,
        content: Buffer.from(input.csvContent, 'utf8').toString('base64'),
      },
    ]
  }

  const { data, error } = await client.emails.send(payload)
  if (error) throw new Error(`Resend error: ${error.message}`)
  if (!data) throw new Error('Resend returned no data')
  return { id: data.id }
}

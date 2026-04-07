import { Resend } from 'resend'

export interface SendEmailInput {
  apiKey: string
  from: string         // e.g. "edge <onboarding@resend.dev>"
  to: string           // recipient address
  subject: string
  html: string
  csvFilename: string
  csvContent: string
}

export interface SendEmailResult {
  id: string
}

export async function sendReportEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const resend = new Resend(input.apiKey)
  const { data, error } = await resend.emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: [
      {
        filename: input.csvFilename,
        content: Buffer.from(input.csvContent, 'utf8').toString('base64'),
      },
    ],
  })
  if (error) throw new Error(`Resend error: ${error.message}`)
  if (!data) throw new Error('Resend returned no data')
  return { id: data.id }
}

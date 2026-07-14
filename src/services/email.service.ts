import { env } from '../config/env.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string
}

export function isEmailEnabled() {
  return Boolean(env.RESEND_API_KEY)
}

/**
 * Send a transactional email through Resend. Never throws: email delivery is
 * best-effort and must not fail the business action that triggered it.
 * Returns true only when Resend accepted the message.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  // Never send real email from the test suite, even if a developer .env has a live key.
  if (env.NODE_ENV === 'test') return false
  if (!env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not configured; skipping email to %s (%s)', input.to, input.subject)
    return false
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text
      })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error('[email] Resend rejected email to %s: %s %s', input.to, response.status, body)
      return false
    }
    return true
  } catch (error) {
    console.error('[email] Failed to send email to %s:', input.to, error)
    return false
  }
}

export interface StaffInvitationEmailInput {
  to: string
  businessName: string
  role: string
  branchNames: string[]
  inviteUrl: string
  expiresAt: Date
}

export async function sendStaffInvitationEmail(input: StaffInvitationEmailInput): Promise<boolean> {
  const roleLabel = input.role === 'cashier' ? 'Cashier' : 'Manager'
  const branchList = input.branchNames.length ? input.branchNames.join(', ') : 'your assigned branches'
  const expiryDays = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
  const subject = `You've been invited to join ${input.businessName} on FahamPesa`

  const text = [
    `You've been invited to join ${input.businessName} on FahamPesa as a ${roleLabel}.`,
    '',
    `Branches: ${branchList}`,
    '',
    'Open the link below to accept the invitation. You will be asked to sign in or create your FahamPesa account (using this email address) and set your password:',
    input.inviteUrl,
    '',
    `This invitation expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}.`,
    '',
    "If you weren't expecting this invitation, you can safely ignore this email."
  ].join('\n')

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td style="font-size:20px;font-weight:700;color:#111827;padding-bottom:16px;">FahamPesa</td>
            </tr>
            <tr>
              <td style="font-size:16px;color:#111827;padding-bottom:8px;font-weight:600;">
                You've been invited to join ${escapeHtml(input.businessName)}
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;color:#374151;line-height:1.6;padding-bottom:16px;">
                You've been invited as a <strong>${roleLabel}</strong> for: ${escapeHtml(branchList)}.<br/>
                Accept the invitation to sign in or create your FahamPesa account with this email address and set your password. Your access will be limited to what your role permits.
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0 20px;">
                <a href="${input.inviteUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">Accept invitation</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#6b7280;line-height:1.6;">
                This invitation expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}. If the button doesn't work, copy this link into your browser:<br/>
                <a href="${input.inviteUrl}" style="color:#2563eb;word-break:break-all;">${input.inviteUrl}</a><br/><br/>
                If you weren't expecting this invitation, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return sendEmail({ to: input.to, subject, html, text })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

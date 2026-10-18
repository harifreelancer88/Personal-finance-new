export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function isSmsAuthorized(request: Request, secret?: string): Promise<boolean> {
  if (!secret) return false
  const authorization = request.headers.get('Authorization')
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : request.headers.get('X-SMS-Token')
  if (!supplied) return false
  return (await sha256(supplied)) === (await sha256(secret))
}

export async function smsDedupeKey(externalId: string | null, sender: string | null, receivedAt: string, message: string): Promise<string> {
  return externalId ? `external:${await sha256(externalId)}` : smsContentKey(sender, receivedAt, message)
}

// Forwarded phone timestamps without an offset are Indian local time. Compare
// the original receipt to second precision across ISO/UTC/IST representations.
export function canonicalSmsTime(receivedAt: string): string {
  let value = receivedAt.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00:00'
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) value += '+05:30'
  return new Date(value).toISOString().slice(0, 19) + 'Z'
}

export async function smsContentKey(sender: string | null, receivedAt: string, message: string): Promise<string> {
  return `content:v2:${await sha256(`${sender ?? ''}\n${canonicalSmsTime(receivedAt)}\n${message}`)}`
}

// The group identifies identical source evidence, not necessarily one payment.
// Keep receipt instants in the unique identity so indistinguishable genuine
// payments are preserved; the group is used only to hold repeats for review.
export async function smsContentGroup(sender: string | null, message: string, transactionDate: string): Promise<string> {
  return `content:v3:${await sha256(JSON.stringify([sender, message, transactionDate]))}:`
}

export async function smsReceiptIdentity(group: string, receivedAt: string): Promise<string> {
  return group + await sha256(canonicalSmsTime(receivedAt))
}

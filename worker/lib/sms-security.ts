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
  return externalId ? `external:${await sha256(externalId)}` : `content:${await sha256(`${sender ?? ''}\n${receivedAt}\n${message}`)}`
}

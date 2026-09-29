export interface ApiEnvelope<T> { success: true; data: T }
export interface ApiFailure { success: false; error: { code: string; message: string } }

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message) }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  let payload: ApiEnvelope<T> | ApiFailure
  try { payload = await response.json() as ApiEnvelope<T> | ApiFailure } catch { throw new ApiClientError('INVALID_RESPONSE', 'The server returned an invalid response.', response.status) }
  if (!response.ok || !payload.success) {
    const error = payload as ApiFailure
    throw new ApiClientError(error.error?.code ?? 'REQUEST_FAILED', error.error?.message ?? 'The request failed.', response.status)
  }
  return payload.data
}

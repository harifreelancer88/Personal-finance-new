export function success<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ success: true, data }, init)
}

export function failure(code: string, message: string, status = 500): Response {
  return Response.json(
    { success: false, error: { code, message } },
    { status },
  )
}

export function methodNotAllowed(): Response {
  return failure('METHOD_NOT_ALLOWED', 'This endpoint does not support that HTTP method.', 405)
}

export function notFound(): Response {
  return failure('NOT_FOUND', 'The requested API endpoint was not found.', 404)
}

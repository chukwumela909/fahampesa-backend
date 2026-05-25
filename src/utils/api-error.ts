export class ApiError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function notFound(message = 'Resource not found') {
  return new ApiError(404, 'not_found', message)
}

import { resolveDemoUrl } from '../../landing/demo-url.js'

export class GatewayError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function apiOrigin(value) {
  if (!value || !resolveDemoUrl(value, true)) return ''
  const url = new URL(value)
  return url.pathname === '/' && !url.search && !url.hash ? url.origin : ''
}

export function gatewayOrigins(env) {
  const allowed = ['https://app.badem.network', 'https://badem.network']
  for (const host of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host && !/[/?#@]/.test(host)) {
      const origin = apiOrigin(`https://${host}`)
      if (origin) allowed.push(origin)
    }
  }
  return allowed
}

export function requireGatewayOrigin(request, allowed) {
  if (
    request.headers['sec-fetch-site'] === 'cross-site' ||
    (request.headers.origin && !allowed.includes(request.headers.origin))
  ) {
    throw new GatewayError(403, 'Request origin is not allowed.')
  }
}

export function reply(response, status, payload, code) {
  if (response.writableEnded || response.destroyed) return
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (code) response.setHeader('X-BADEM-Error', code)
  response.end(JSON.stringify(payload))
}

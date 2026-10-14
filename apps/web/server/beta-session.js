import { env as runtimeEnv } from 'node:process'
import { authenticateBeta } from './private-beta.js'
import { GatewayError, gatewayOrigins, requireGatewayOrigin, reply } from './gateway-http.js'

export function createBetaSession({
  env = runtimeEnv,
  fetcher = globalThis.fetch,
  allowedOrigins = gatewayOrigins(env),
  timeoutMs = 10000,
} = {}) {
  return async function betaSession(request, response) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timer = setTimeout(abort, timeoutMs)
    request.on?.('aborted', abort)
    response.on?.('close', abort)
    try {
      if (
        !['/badem-api/auth/session', '/api/beta-session', '/api/beta-session.js'].includes(
          request.url,
        ) ||
        Object.keys(request.query || {}).length
      )
        throw new GatewayError(404, 'Endpoint unavailable.')
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET')
        throw new GatewayError(405, 'Method not allowed.')
      }
      requireGatewayOrigin(request, allowedOrigins)
      if (
        request.headers['transfer-encoding'] ||
        Number(request.headers['content-length'] || 0) !== 0
      )
        throw new GatewayError(400, 'Invalid request.')
      const user = await authenticateBeta(request, { env, fetcher, signal: controller.signal })
      reply(response, 200, { user })
    } catch (error) {
      const status = controller.signal.aborted
        ? 504
        : error instanceof GatewayError
          ? error.status
          : 503
      const message = controller.signal.aborted
        ? 'Sign-in check timed out. Please try again.'
        : error instanceof GatewayError
          ? error.message
          : 'Sign-in is temporarily unavailable. Please try again later.'
      reply(
        response,
        status,
        { detail: message },
        error instanceof GatewayError ? error.code : undefined,
      )
    } finally {
      clearTimeout(timer)
      controller.abort()
      request.removeListener?.('aborted', abort)
      response.removeListener?.('close', abort)
    }
  }
}

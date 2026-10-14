import { env as runtimeEnv } from 'node:process'
import { resolveDemoUrl } from '../../landing/demo-url.js'

const MAX_REQUEST_BYTES = 65536
const MAX_RESPONSE_BYTES = 1048576
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const ENDPOINTS = [
  { path: /^manufacturing-requests$/, method: 'POST', body: true },
  {
    path: new RegExp(`^manufacturing-requests/${UUID}/specification$`),
    method: 'POST',
    body: true,
  },
  { path: new RegExp(`^manufacturing-requests/${UUID}/discover$`), method: 'POST', body: false },
  { path: new RegExp(`^partner-candidates/${UUID}$`), method: 'GET', body: false },
]

class ProxyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function apiOrigin(value) {
  if (!value || !resolveDemoUrl(value, true)) return ''
  const url = new URL(value)
  return url.pathname === '/' && !url.search && !url.hash ? url.origin : ''
}

function origins(env) {
  const allowed = ['https://app.badem.network', 'https://badem.network']
  for (const host of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host && !/[/?#@]/.test(host)) {
      const origin = apiOrigin(`https://${host}`)
      if (origin) allowed.push(origin)
    }
  }
  return allowed
}

async function requestBody(request, needsBody) {
  const length = Number(request.headers['content-length'] || 0)
  if (!Number.isFinite(length) || length < 0) throw new ProxyError(400, 'Invalid request.')
  if (length > MAX_REQUEST_BYTES) throw new ProxyError(413, 'Request is too large.')
  if (needsBody && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw new ProxyError(415, 'Use a JSON request body.')
  }
  let body
  try {
    body = request.body
    if (body === undefined) {
      const chunks = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_REQUEST_BYTES) throw new ProxyError(413, 'Request is too large.')
        chunks.push(buffer)
      }
      body = Buffer.concat(chunks).toString('utf8')
    }
    if (body === undefined || body === null || body === '') {
      if (needsBody) throw new ProxyError(400, 'A JSON request body is required.')
      return undefined
    }
    if (!needsBody) throw new ProxyError(400, 'This endpoint does not accept a request body.')
    if (Buffer.isBuffer(body)) body = body.toString('utf8')
    if (typeof body === 'string') body = JSON.parse(body)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('Invalid JSON object')
    const values = [body]
    while (values.length) {
      const value = values.pop()
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('Non-finite JSON number')
      if (value && typeof value === 'object') values.push(...Object.values(value))
    }
    const encoded = JSON.stringify(body)
    if (Buffer.byteLength(encoded) > MAX_REQUEST_BYTES)
      throw new ProxyError(413, 'Request is too large.')
    return encoded
  } catch (error) {
    if (error instanceof ProxyError) throw error
    throw new ProxyError(400, 'Invalid JSON request.')
  }
}

async function responseJson(response, secret) {
  const chunks = []
  let bytes = 0
  if (!response.body) throw new ProxyError(502, 'The BADEM service returned an invalid response.')
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > MAX_RESPONSE_BYTES)
      throw new ProxyError(502, 'The BADEM service returned an invalid response.')
    chunks.push(chunk)
  }
  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ProxyError(502, 'The BADEM service returned an invalid response.')
  }
  const strings = [payload]
  while (strings.length) {
    const value = strings.pop()
    if (typeof value === 'string' && (value.includes(secret) || /AIza[\w-]{35}/.test(value))) {
      throw new ProxyError(502, 'The BADEM service returned an invalid response.')
    }
    if (value && typeof value === 'object') {
      strings.push(...Object.keys(value), ...Object.values(value))
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProxyError(502, 'The BADEM service returned an invalid response.')
  }
  return payload
}

function reply(response, status, payload) {
  if (response.writableEnded || response.destroyed) return
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(payload))
}

export function createDiscoveryProxy({
  env = runtimeEnv,
  fetcher = globalThis.fetch,
  allowedOrigins = origins(env),
  timeoutMs = 110000,
} = {}) {
  return async function discoveryProxy(request, response) {
    let timer
    const controller = new AbortController()
    const abort = () => controller.abort()
    try {
      const params = new URL(request.url, 'https://proxy.invalid').searchParams
      const query = request.query || Object.fromEntries(params)
      const path = query.path
      const endpoint =
        typeof path === 'string' && ENDPOINTS.find((item) => item.path.exec(path)?.[0] === path)
      if (
        !endpoint ||
        Object.keys(query).some((key) => key !== 'path') ||
        [...params.keys()].some((key) => key !== 'path')
      )
        throw new ProxyError(404, 'Endpoint unavailable.')
      // Duplicate routing parameters are rejected rather than choosing one of them.
      if (params.getAll('path').length > 1) throw new ProxyError(404, 'Endpoint unavailable.')
      if (request.method !== endpoint.method) {
        response.setHeader('Allow', endpoint.method)
        throw new ProxyError(405, 'Method not allowed.')
      }
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin && !allowedOrigins.includes(request.headers.origin))
      ) {
        throw new ProxyError(403, 'Request origin is not allowed.')
      }
      const origin = apiOrigin(env.BADEM_API_ORIGIN)
      const secret = env.BADEM_SERVER_ADMIN_KEY
      if (!origin || typeof secret !== 'string' || !secret.trim() || /[\r\n]/.test(secret)) {
        throw new ProxyError(503, 'The BADEM service is not configured.')
      }
      const body = await requestBody(request, endpoint.body)
      timer = setTimeout(abort, timeoutMs)
      request.on?.('aborted', abort)
      response.on?.('close', abort)
      const upstream = await fetcher(`${origin}/api/${path}`, {
        method: endpoint.method,
        headers: {
          'X-Admin-Key': secret,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        redirect: 'error',
        signal: controller.signal,
      })
      if (!upstream.ok) {
        const status = [404, 409, 422, 429, 504].includes(upstream.status) ? upstream.status : 502
        throw new ProxyError(
          status,
          status === 422
            ? 'Invalid request values.'
            : 'The BADEM service is temporarily unavailable.',
        )
      }
      reply(response, upstream.status, await responseJson(upstream, secret))
    } catch (error) {
      const status = controller.signal.aborted
        ? 504
        : error instanceof ProxyError
          ? error.status
          : 502
      const message = controller.signal.aborted
        ? 'The BADEM service timed out.'
        : error instanceof ProxyError
          ? error.message
          : 'The BADEM service is temporarily unavailable.'
      reply(response, status, { detail: message })
    } finally {
      controller.abort()
      clearTimeout(timer)
      request.removeListener?.('aborted', abort)
      response.removeListener?.('close', abort)
    }
  }
}

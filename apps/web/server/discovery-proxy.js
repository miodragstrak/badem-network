import { env as runtimeEnv } from 'node:process'
import { GatewayError as ProxyError, apiOrigin, gatewayOrigins, requireGatewayOrigin, reply } from './gateway-http.js'
import { authenticateBeta, reserveDiscovery } from './private-beta.js'

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

function discoveryPath(request) {
  const rawUrl = request.url
  if (
    typeof rawUrl !== 'string' ||
    !rawUrl.startsWith('/') ||
    rawUrl.startsWith('//') ||
    /[\s\\%#]/.test(rawUrl) ||
    [...rawUrl].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    /\/(?:\.|\.\.)(?:\/|\?|$)/.test(rawUrl)
  )
    throw new ProxyError(404, 'Endpoint unavailable.')
  const url = new URL(rawUrl, 'https://proxy.invalid')
  const route = /^\/(badem-api\/api|api\/discovery)\/(.+)$/.exec(url.pathname)
  let path = route?.[2]
  // Legacy Vercel function targets include .js; public API paths do not.
  if (route?.[1] === 'api/discovery') path = path.replace(/\.js$/, '')
  const query = request.query || Object.fromEntries(url.searchParams)
  if (
    !path ||
    Object.keys(query).some((key) => key !== 'id') ||
    [...url.searchParams.keys()].some((key) => key !== 'id') ||
    url.searchParams.getAll('id').length > 1
  )
    throw new ProxyError(404, 'Endpoint unavailable.')
  // Vercel adds the filesystem [id] parameter. It must agree with the URL, never override it.
  const id = query.id === undefined ? url.searchParams.get('id') ?? undefined : query.id
  if (id !== undefined) {
    if (
      typeof id !== 'string' ||
      new RegExp(`^${UUID}$`).exec(id)?.[0] !== id ||
      (url.searchParams.has('id') && url.searchParams.get('id') !== id)
    )
      throw new ProxyError(404, 'Endpoint unavailable.')
    path = path.replace('[id]', id)
    if (path.split('/')[1] !== id) throw new ProxyError(404, 'Endpoint unavailable.')
  }
  return path
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
    if (Object.hasOwn(body, 'owner_user_id')) throw new ProxyError(400, 'Invalid request values.')
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

async function responseJson(response, secrets) {
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
    if (typeof value === 'string' && (secrets.some((secret) => value.includes(secret)) || /AIza[\w-]{35}/.test(value) || /sb_secret_[\w-]{16,}/.test(value))) {
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

export function createDiscoveryProxy({
  env = runtimeEnv,
  fetcher = globalThis.fetch,
  securityFetcher = globalThis.fetch,
  allowedOrigins = gatewayOrigins(env),
  timeoutMs = 110000,
} = {}) {
  return async function discoveryProxy(request, response) {
    let timer
    const controller = new AbortController()
    const abort = () => controller.abort()
    try {
      const path = discoveryPath(request)
      const endpoint = ENDPOINTS.find((item) => item.path.exec(path)?.[0] === path)
      if (!endpoint) throw new ProxyError(404, 'Endpoint unavailable.')
      if (request.method !== endpoint.method) {
        response.setHeader('Allow', endpoint.method)
        throw new ProxyError(405, 'Method not allowed.')
      }
      requireGatewayOrigin(request, allowedOrigins)
      const origin = apiOrigin(env.BADEM_API_ORIGIN)
      const secret = env.BADEM_SERVER_ADMIN_KEY
      if (!origin || typeof secret !== 'string' || !secret.trim() || /[\r\n]/.test(secret)) {
        throw new ProxyError(503, 'The BADEM service is not configured.')
      }
      const body = await requestBody(request, endpoint.body)
      timer = setTimeout(abort, timeoutMs)
      request.on?.('aborted', abort)
      response.on?.('close', abort)
      const user = await authenticateBeta(request, { env, fetcher: securityFetcher, signal: controller.signal })
      if (path.endsWith('/discover')) {
        await reserveDiscovery(user, { env, fetcher: securityFetcher, signal: controller.signal })
      }
      controller.signal.throwIfAborted()
      const upstream = await fetcher(`${origin}/api/${path}`, {
        method: endpoint.method,
        headers: {
          'X-Admin-Key': secret,
          'X-BADEM-User-Id': user.id,
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
      reply(response, upstream.status, await responseJson(upstream, [secret, env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean)))
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
      reply(response, status, { detail: message }, error instanceof ProxyError ? error.code : undefined)
    } finally {
      controller.abort()
      clearTimeout(timer)
      request.removeListener?.('aborted', abort)
      response.removeListener?.('close', abort)
    }
  }
}

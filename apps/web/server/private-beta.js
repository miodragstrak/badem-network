import { apiOrigin, GatewayError } from './gateway-http.js'
import { isPublishableKey } from '../src/auth/config.js'
import {
  BETA_INVITE_MESSAGE,
  BETA_LIMIT_MESSAGE,
  BETA_SESSION_MESSAGE,
} from '../src/auth/messages.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UNAVAILABLE = 'Private Beta discovery is temporarily unavailable. Please try again later.'

function sessionRequired() {
  return new GatewayError(401, BETA_SESSION_MESSAGE, 'SESSION_REQUIRED')
}

function tokenClaims(header, origin, now) {
  if (
    typeof header !== 'string' ||
    header.length > 8192 ||
    !/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(header)
  ) {
    throw sessionRequired()
  }
  const token = header.slice(7)
  try {
    const [head, body] = token
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')))
    if (
      !head.alg ||
      head.alg === 'none' ||
      body.role !== 'authenticated' ||
      !(Array.isArray(body.aud)
        ? body.aud.includes('authenticated')
        : body.aud === 'authenticated') ||
      body.iss !== `${origin}/auth/v1` ||
      !UUID.test(body.sub || '') ||
      !Number.isSafeInteger(body.exp) ||
      body.exp <= now ||
      (body.nbf !== undefined && (!Number.isSafeInteger(body.nbf) || body.nbf > now))
    )
      throw sessionRequired()
    // Parsing only rejects invalid input. Supabase Auth must validate the token below.
    return { token, claims: body }
  } catch {
    throw sessionRequired()
  }
}

async function providerJson(url, options, fetcher, signal) {
  try {
    const response = await fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    })
    if ([401, 403, 404].includes(response.status) && url.endsWith('/auth/v1/user'))
      throw sessionRequired()
    if (!response.ok || !response.body) throw new GatewayError(503, UNAVAILABLE)
    let bytes = 0
    const chunks = []
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > 16384) throw new GatewayError(503, UNAVAILABLE)
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error instanceof GatewayError) throw error
    throw new GatewayError(503, UNAVAILABLE)
  }
}

export async function authenticateBeta(
  request,
  { env, fetcher, signal, now = Math.floor(Date.now() / 1000) },
) {
  // Missing/malformed credentials cannot trigger even an Auth provider request.
  if (
    typeof request.headers.authorization !== 'string' ||
    !request.headers.authorization.startsWith('Bearer ')
  )
    throw sessionRequired()
  const origin = apiOrigin(env.SUPABASE_URL)
  if (!origin || !isPublishableKey(env.SUPABASE_PUBLISHABLE_KEY))
    throw new GatewayError(503, UNAVAILABLE)
  const { token, claims } = tokenClaims(request.headers.authorization, origin, now)
  const user = await providerJson(
    `${origin}/auth/v1/user`,
    {
      method: 'GET',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    },
    fetcher,
    signal,
  )
  if (
    !user ||
    user.id !== claims.sub ||
    !UUID.test(user.id || '') ||
    user.role !== 'authenticated' ||
    user.is_anonymous ||
    typeof user.email !== 'string' ||
    !user.email.trim() ||
    !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
    (user.banned_until && Date.parse(user.banned_until) > now * 1000)
  )
    throw sessionRequired()
  const email = user.email.trim().toLowerCase()
  const allowed = (env.BADEM_BETA_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (!allowed.includes(email))
    throw new GatewayError(403, BETA_INVITE_MESSAGE, 'BETA_INVITE_REQUIRED')
  return { id: user.id, email }
}

function quotaKey(env) {
  const secret = env.SUPABASE_SECRET_KEY
  const legacy = env.SUPABASE_SERVICE_ROLE_KEY
  if (secret && legacy) throw new GatewayError(503, UNAVAILABLE)
  if (secret && /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(secret)) return { apikey: secret }
  try {
    const parts = legacy?.split('.')
    if (
      parts?.length === 3 &&
      parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)) &&
      JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role'
    ) {
      return { apikey: legacy, Authorization: `Bearer ${legacy}` }
    }
  } catch {
    /* Invalid privileged configuration fails closed. */
  }
  throw new GatewayError(503, UNAVAILABLE)
}

export async function reserveDiscovery(user, { env, fetcher, signal }) {
  const origin = apiOrigin(env.SUPABASE_URL)
  if (!origin) throw new GatewayError(503, UNAVAILABLE)
  const allowed = await providerJson(
    `${origin}/rest/v1/rpc/consume_badem_discovery`,
    {
      method: 'POST',
      headers: { ...quotaKey(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: user.id }),
    },
    fetcher,
    signal,
  )
  if (allowed === false) throw new GatewayError(429, BETA_LIMIT_MESSAGE, 'DISCOVERY_LIMIT')
  if (allowed !== true) throw new GatewayError(503, UNAVAILABLE)
}

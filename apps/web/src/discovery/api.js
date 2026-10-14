import { BETA_INVITE_MESSAGE, BETA_LIMIT_MESSAGE, BETA_SESSION_MESSAGE } from '../auth/messages.js'

export class DiscoveryError extends Error {
  constructor(message, status = 0, code = '') {
    super(message)
    this.name = 'DiscoveryError'
    this.status = status
    this.code = code
  }
}

function errorMessage(status, action, code) {
  if (status === 401) return BETA_SESSION_MESSAGE
  if (status === 403 && code === 'BETA_INVITE_REQUIRED') return BETA_INVITE_MESSAGE
  if (status === 403) return 'Discovery is temporarily unavailable. Please try again later.'
  if (status === 429 && code === 'DISCOVERY_LIMIT') return BETA_LIMIT_MESSAGE
  if (status === 422)
    return 'Some request values were not accepted. Review the fields and try again.'
  if (status === 404)
    return 'This request or profile is no longer available. Start a new request or discover partners again.'
  if (status === 409)
    return 'The specification changed while discovery was running. Review it and try again.'
  if (action === 'discover')
    return 'Partner discovery is temporarily unavailable. Your specification is preserved. Please try again.'
  if (action === 'profile') return 'The partner profile could not be loaded. Please try again.'
  if (action === 'specification')
    return 'The manufacturing specification could not be saved. Your entries are preserved. Please try again.'
  return 'The manufacturing request could not be saved. Your entries are preserved. Please try again.'
}

// Identity tokens go only to the same-origin gateway, never directly to Render.
export function createDiscoveryApi(config = {}) {
  const baseUrl = '/badem-api'
  const { fetcher = globalThis.fetch, timeoutMs = 120000, getAccessToken, onAccessError } = config
  async function request(path, { payload, signal, action } = {}) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timeout = setTimeout(abort, timeoutMs)
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      controller.signal.throwIfAborted()
      const token = await getAccessToken?.()
      controller.signal.throwIfAborted()
      if (typeof token !== 'string' || !token || /\s/.test(token)) {
        throw new DiscoveryError(BETA_SESSION_MESSAGE, 401)
      }
      const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}${path}`, {
        method: payload !== undefined || action === 'discover' ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
      })
      // Never render provider response bodies: they can contain internal details.
      if (!response.ok) {
        const code = response.headers?.get('X-BADEM-Error')
        throw new DiscoveryError(errorMessage(response.status, action, code), response.status, code)
      }
      return await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof DiscoveryError) {
        if (error.status === 401 || (error.status === 403 && error.code === 'BETA_INVITE_REQUIRED')) {
          onAccessError?.(error.status)
        }
        throw error
      }
      throw new DiscoveryError(errorMessage(0, action))
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  return {
    createRequest: (payload, signal) => request('/api/manufacturing-requests', { payload, signal }),
    saveSpecification: (id, payload, signal) =>
      request(`/api/manufacturing-requests/${encodeURIComponent(id)}/specification`, {
        payload,
        signal,
        action: 'specification',
      }),
    discover: (id, signal) =>
      request(`/api/manufacturing-requests/${encodeURIComponent(id)}/discover`, {
        signal,
        action: 'discover',
      }),
    getProfile: (id, signal) =>
      request(`/api/partner-candidates/${encodeURIComponent(id)}`, { signal, action: 'profile' }),
  }
}

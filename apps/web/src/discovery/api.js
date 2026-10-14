export class DiscoveryError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'DiscoveryError'
    this.status = status
  }
}

function errorMessage(status, action) {
  if (status === 401 || status === 403)
    return 'Access to the BADEM API is not configured. Please contact the demo administrator.'
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

// Public builds use only the same-origin server proxy; local demos may use a key.
export function createDiscoveryApi(config = {}) {
  const { baseUrl, adminKey, production } = browserApiConfig(config)
  const { fetcher = globalThis.fetch, timeoutMs = 120000 } = config
  async function request(path, { payload, signal, action } = {}) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timeout = setTimeout(abort, timeoutMs)
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}${path}`, {
        method: payload !== undefined || action === 'discover' ? 'POST' : 'GET',
        headers: {
          ...(!production && adminKey ? { 'X-Admin-Key': adminKey } : {}),
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
      })
      // Never render provider response bodies: they can contain internal details.
      if (!response.ok)
        throw new DiscoveryError(errorMessage(response.status, action), response.status)
      return await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof DiscoveryError) throw error
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
import { browserApiConfig } from '../api-config.js'

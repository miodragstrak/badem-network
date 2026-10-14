import { createDiscoveryProxy } from './discovery-proxy.js'
import { createBetaSession } from './beta-session.js'
import { GatewayError } from './gateway-http.js'

export function privateBetaDevPlugin(env) {
  return {
    name: 'badem-private-beta-gateway',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!/^\/badem-api(?:\/|$)/.test(request.url || '')) return next()
        const address = server.httpServer?.address()
        const port =
          typeof address === 'object' && address ? address.port : server.config.server.port
        const allowedOrigins = [
          `http://127.0.0.1:${port}`,
          `http://localhost:${port}`,
          `http://[::1]:${port}`,
        ]
        let target
        try {
          const url = new URL(env.BADEM_API_PROXY_TARGET || 'http://127.0.0.1:8000')
          if (
            ['http:', 'https:'].includes(url.protocol) &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash
          )
            target = url.origin
        } catch {
          /* A malformed development target never opens a generic proxy. */
        }
        const fetcher = (url, options) => {
          if (!target) throw new GatewayError(503, 'Local discovery is temporarily unavailable.')
          return fetch(`${target}${new URL(url).pathname}`, options)
        }
        if (request.url === '/badem-api/auth/session') {
          return createBetaSession({ env, allowedOrigins })(request, response)
        }
        return createDiscoveryProxy({ env, allowedOrigins, fetcher })(request, response)
      })
    },
  }
}

import { createDiscoveryProxy } from './discovery-proxy.js'
import { createBetaSession } from './beta-session.js'
import { loopbackOrigin } from './gateway-http.js'

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
        const target = loopbackOrigin(env.BADEM_API_PROXY_TARGET || 'http://127.0.0.1:8000')
        if (request.url === '/badem-api/auth/session') {
          return createBetaSession({ env, allowedOrigins })(request, response)
        }
        return createDiscoveryProxy({ env, allowedOrigins, developmentTarget: target })(request, response)
      })
    },
  }
}

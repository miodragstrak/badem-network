import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDiscoveryProxy } from '../server/discovery-proxy.js'
import { loopbackOrigin } from '../server/gateway-http.js'
import { privateBetaDevPlugin } from '../server/private-beta-dev.js'
import { betaEnvironment, betaFetcher, betaToken, betaUser } from './helpers/beta-fixtures.mjs'

const id = 'b07127c3-7a8e-44da-b43f-a5fdd2b83d21'
const port = 55231
const adminKey = 'local-gateway-unit-key-only'
const environment = { ...betaEnvironment, BADEM_SERVER_ADMIN_KEY: adminKey }

function devGateway(env) {
  let middleware
  const plugin = privateBetaDevPlugin(env)
  assert.equal(plugin.apply, 'serve')
  plugin.configureServer({
    config: { server: { port: 5173 } },
    httpServer: { address: () => ({ port }) },
    middlewares: { use(handler) { middleware = handler } },
  })
  return middleware
}

async function invoke(handler, {
  url = '/badem-api/api/manufacturing-requests',
  method = 'POST',
  body = { title: 'Local workshop discovery' },
  headers = {},
} = {}) {
  const request = { url, method, body, headers: {
    origin: `http://localhost:${port}`,
    authorization: `Bearer ${betaToken}`,
    'content-type': 'application/json',
    ...headers,
  } }
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value },
    end(value) { this.payload = JSON.parse(value); this.writableEnded = true } }
  let next = false
  await handler(request, response, () => { next = true })
  if (!next) {
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.equal(response.headers['Vercel-CDN-Cache-Control'], 'no-store')
    assert.ok(!JSON.stringify(response.payload).includes(adminKey))
  }
  return { response, next }
}

function mockedFetch(t, { consume = () => true } = {}) {
  const security = []
  const backend = []
  const authenticate = betaFetcher({ calls: security, consume })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (new URL(url).origin === betaEnvironment.SUPABASE_URL) return authenticate(url, options)
    backend.push({ url, ...options })
    return Response.json({ id }, { status: 201 })
  })
  return { security, backend }
}

for (const target of ['http://127.0.0.1:8000', 'http://localhost:8001', 'http://[::1]:8002', 'https://localhost:8443']) {
  test(`local Vite gateway uses ${target} without BADEM_API_ORIGIN for every allowed operation`, async (t) => {
    const { backend, security } = mockedFetch(t)
    const gateway = devGateway({ ...environment, BADEM_API_PROXY_TARGET: target })
    for (const [path, method, body] of [
      ['manufacturing-requests', 'POST', { title: 'Local workshop discovery' }],
      [`manufacturing-requests/${id}/specification`, 'POST', { process: ['laser_engraving'], materials: ['wood'] }],
      [`manufacturing-requests/${id}/discover`, 'POST', ''],
      [`partner-candidates/${id}`, 'GET', ''],
    ]) {
      const { response } = await invoke(gateway, { url: `/badem-api/api/${path}`, method, body,
        headers: { 'x-admin-key': 'spoofed', 'x-badem-user-id': 'spoofed' } })
      assert.equal(response.statusCode, 201)
      const call = backend.at(-1)
      assert.equal(call.url, `${target}/api/${path}`)
      assert.equal(call.headers['X-Admin-Key'], adminKey)
      assert.equal(call.headers['X-BADEM-User-Id'], betaUser.id)
      assert.equal(call.headers.Authorization, undefined)
      assert.equal(call.redirect, 'error')
      assert.ok(call.signal instanceof AbortSignal)
    }
    assert.equal(backend.length, 4)
    assert.equal(security.filter(call => call.url.endsWith('/auth/v1/user')).length, 4)
    assert.equal(security.filter(call => call.url.endsWith('/consume_badem_discovery')).length, 1)
  })
}

test('local default remains loopback and ignores an invalid production origin', async (t) => {
  const { backend } = mockedFetch(t)
  const { response } = await invoke(devGateway({ ...environment, BADEM_API_ORIGIN: 'not-an-origin' }))
  assert.equal(response.statusCode, 201)
  assert.equal(backend[0].url, 'http://127.0.0.1:8000/api/manufacturing-requests')
})

for (const target of ['invalid', 'ftp://localhost:8000', 'http://0.0.0.0:8000', 'http://127.0.0.2:8000',
  'http://10.0.0.1:8000', 'http://169.254.169.254', 'http://localhost.evil.example', 'http://[::ffff:127.0.0.1]',
  'https://api.badem.network', 'http://user:pass@localhost:8000', 'http://localhost:8000/api',
  'http://localhost:8000?target=evil', 'http://localhost:8000#fragment']) {
  test(`invalid development target fails closed: ${target}`, async (t) => {
    const { backend, security } = mockedFetch(t)
    assert.equal(loopbackOrigin(target), '')
    const gateway = devGateway({ ...environment, BADEM_API_PROXY_TARGET: target, BADEM_API_ORIGIN: 'https://api.badem.network' })
    const { response } = await invoke(gateway, { url: `/badem-api/api/manufacturing-requests/${id}/discover`, body: '' })
    assert.equal(response.statusCode, 503)
    assert.deepEqual(backend, [])
    assert.deepEqual(security, [], 'Invalid local configuration must not reserve quota or contact Auth')
  })
}

test('local gateway still requires admin auth, an invited session, valid origin and quota', async (t) => {
  const { backend, security } = mockedFetch(t, { consume: () => false })
  for (const key of [undefined, '', ' ', 'bad\r\nheader']) {
    const { response } = await invoke(devGateway({ ...environment, BADEM_SERVER_ADMIN_KEY: key }))
    assert.equal(response.statusCode, 503)
  }
  assert.deepEqual(security, [])
  const gateway = devGateway(environment)
  const signedOut = await invoke(gateway, { headers: { authorization: undefined } })
  assert.equal(signedOut.response.statusCode, 401)
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'http://localhost:5173' },
    { origin: `http://127.0.0.2:${port}` }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await invoke(gateway, { headers })).response.statusCode, 403)
  }
  const notInvited = await invoke(devGateway({ ...environment, BADEM_BETA_EMAIL_ALLOWLIST: 'someone-else@example.org' }))
  assert.equal(notInvited.response.statusCode, 403)
  const quota = await invoke(gateway, { url: `/badem-api/api/manufacturing-requests/${id}/discover`, body: '' })
  assert.equal(quota.response.statusCode, 429)
  assert.equal(quota.response.headers['X-BADEM-Error'], 'DISCOVERY_LIMIT')
  assert.deepEqual(backend, [])
})

test('development backend target is never taken from browser headers or query values', async (t) => {
  const { backend } = mockedFetch(t)
  const gateway = devGateway(environment)
  const { response } = await invoke(gateway, { headers: { 'x-badem-api-proxy-target': 'https://evil.example' } })
  assert.equal(response.statusCode, 201)
  assert.equal(backend[0].url, 'http://127.0.0.1:8000/api/manufacturing-requests')
  for (const url of ['/badem-api/api/jobs', '/badem-api/api/manufacturing-requests?developmentTarget=http://evil.example']) {
    assert.equal((await invoke(gateway, { url })).response.statusCode, 404)
  }
  assert.equal(backend.length, 1)
  assert.equal((await invoke(gateway, { url: '/discovery' })).next, true)
})

for (const origin of [undefined, '', 'http://api.badem.network', 'http://localhost:8000', 'https://localhost:8000',
  'https://127.0.0.1:8000', 'https://[::1]:8000', 'https://10.0.0.1', 'https://user:pass@api.badem.network',
  'https://api.badem.network/api', 'https://api.badem.network?target=local']) {
  test(`production rejects invalid or absent HTTPS public origin: ${origin}`, async () => {
    const calls = []
    const fetcher = async (...args) => { calls.push(args); throw new Error('Unexpected network') }
    const proxy = createDiscoveryProxy({ env: { ...environment, BADEM_API_ORIGIN: origin,
      BADEM_API_PROXY_TARGET: 'http://127.0.0.1:8000', NODE_ENV: 'development' }, fetcher, securityFetcher: fetcher })
    const { response } = await invoke(proxy, { headers: { origin: 'https://app.badem.network' } })
    assert.equal(response.statusCode, 503)
    assert.deepEqual(calls, [])
  })
}

test('production accepts public HTTPS origin and ignores local proxy target configuration', async () => {
  const calls = []
  const proxy = createDiscoveryProxy({ env: { ...environment, BADEM_API_ORIGIN: 'https://api.badem.network',
    BADEM_API_PROXY_TARGET: 'http://127.0.0.1:8000' }, securityFetcher: betaFetcher(),
    fetcher: async (url, options) => { calls.push({ url, ...options }); return Response.json({ id }, { status: 201 }) } })
  const { response } = await invoke(proxy, { headers: { origin: 'https://app.badem.network' } })
  assert.equal(response.statusCode, 201)
  assert.equal(calls[0].url, 'https://api.badem.network/api/manufacturing-requests')
  assert.equal(calls[0].headers['X-Admin-Key'], adminKey)
})

test('an explicit development option is revalidated and cannot open a public or arbitrary proxy', async () => {
  for (const developmentTarget of ['', 'http://evil.example', 'https://api.badem.network', 'http://localhost:8000/path']) {
    const calls = []
    const fetcher = async (...args) => { calls.push(args); throw new Error('Unexpected network') }
    const proxy = createDiscoveryProxy({ env: { ...environment, BADEM_API_ORIGIN: 'https://api.badem.network' },
      developmentTarget, fetcher, securityFetcher: fetcher })
    const { response } = await invoke(proxy, { headers: { origin: 'https://app.badem.network' } })
    assert.equal(response.statusCode, 503)
    assert.deepEqual(calls, [])
  }
})

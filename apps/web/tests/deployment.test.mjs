import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { getTransformedRoutes } from '@vercel/routing-utils'
import { createDiscoveryApi } from '../src/discovery/api.js'
import { browserApiConfig } from '../src/api-config.js'
import { createDiscoveryProxy } from '../server/discovery-proxy.js'
import { betaEnvironment, betaToken, betaFetcher, betaUser } from './helpers/beta-fixtures.mjs'

const id = 'b07127c3-7a8e-44da-b43f-a5fdd2b83d21'
const serverKey = 'unit-test-server-key-not-a-real-credential'
const environment = {
  ...betaEnvironment,
  BADEM_API_ORIGIN: 'https://api.badem.network',
  BADEM_SERVER_ADMIN_KEY: serverKey,
}

async function invoke({
  path = 'manufacturing-requests',
  method = 'POST',
  body = { title: 'Wooden tag' },
  headers = {},
  query,
  url,
  env = environment,
  fetcher,
  timeoutMs,
} = {}) {
  const request = Object.assign(new EventEmitter(), {
    method,
    body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${betaToken}`, ...headers },
    url: url || `/api/discovery/${path}`,
    query: query || {},
  })
  const response = Object.assign(new EventEmitter(), {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value) {
      this.payload = JSON.parse(value)
      this.writableEnded = true
    },
  })
  const calls = []
  const proxy = createDiscoveryProxy({
    env,
    securityFetcher: betaFetcher(),
    timeoutMs,
    fetcher: async (url, options) => {
      calls.push({ url, ...options })
      return fetcher
        ? fetcher(url, options)
        : Response.json({ id, status: 'DRAFT' }, { status: 201 })
    },
  })
  await proxy(request, response)
  return { response, calls }
}

test('client ignores admin keys and cross-origin overrides in every app mode', async () => {
  assert.deepEqual(
    browserApiConfig({ production: true, baseUrl: 'http://localhost:8000', adminKey: serverKey }),
    { production: true, baseUrl: '/badem-api', adminKey: '' },
  )
  assert.equal(
    browserApiConfig({ production: false, adminKey: 'local-only' }).adminKey,
    '',
  )
  const calls = []
  const api = createDiscoveryApi({
    production: true,
    adminKey: serverKey,
    getAccessToken: async () => betaToken,
    baseUrl: 'https://wrong.badem.network',
    fetcher: async (url, options) => {
      calls.push({ url, ...options })
      return { ok: true, json: async () => ({ id }) }
    },
  })
  await api.createRequest({ title: 'A' })
  await api.saveSpecification(id, { process: ['laser_engraving'], materials: ['wood'] })
  await api.discover(id)
  await api.getProfile(id)
  assert.ok(calls.every((call) => call.url.startsWith('/badem-api/api/')))
  assert.ok(calls.every((call) => !('X-Admin-Key' in call.headers)))
  assert.ok(calls.every((call) => !Object.keys(call.headers).some((name) => name.toLowerCase() === 'x-badem-user-id')))
  assert.ok(calls.every((call) => !JSON.stringify(call).includes(serverKey)))
})

test('proxy injects server auth only into the four allowed upstream operations', async () => {
  for (const [path, method, body] of [
    ['manufacturing-requests', 'POST', { title: 'A' }],
    [
      `manufacturing-requests/${id}/specification`,
      'POST',
      { process: ['laser_engraving'], materials: ['wood'] },
    ],
    [`manufacturing-requests/${id}/discover`, 'POST', ''],
    [`partner-candidates/${id}`, 'GET', ''],
  ]) {
    const { response, calls } = await invoke({
      path,
      method,
      body,
      headers: {
        'x-admin-key': 'attacker-key',
        'x-badem-user-id': '7069a579-01cf-4a10-a1c2-70e87652acfd',
        authorization: `Bearer ${betaToken}`,
        cookie: 'never-forward',
      },
    })
    assert.equal(response.statusCode, 201)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `https://api.badem.network/api/${path}`)
    assert.equal(calls[0].headers['X-Admin-Key'], serverKey)
    assert.equal(calls[0].headers['X-BADEM-User-Id'], betaUser.id)
    assert.equal(calls[0].headers.authorization, undefined)
    assert.equal(calls[0].headers.cookie, undefined)
    assert.equal(calls[0].redirect, 'error')
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
    assert.ok(!JSON.stringify(response.payload).includes(serverKey))
  }
})

test('proxy rejects all non-discovery paths and path/URL manipulation without upstream I/O', async () => {
  for (const path of [
    'jobs',
    'health',
    `proofs/${id}/anchor`,
    `demo/jobs/${id}`,
    'machine-events',
    `manufacturing-requests/${id}`,
    `manufacturing-requests/${id}/candidates`,
    'https://evil.example/collect',
    '//evil.example/collect',
    '../jobs',
    `manufacturing-requests/${id}/discover/`,
    `manufacturing-requests/${id}/../discover`,
    'manufacturing-requests%2F..%2Fjobs',
    'manufacturing-requests\n',
    '',
  ]) {
    const { response, calls } = await invoke({ path })
    assert.equal(response.statusCode, 404)
    assert.equal(calls.length, 0)
  }
  const query = { path: 'manufacturing-requests', url: 'https://evil.example' }
  const { response, calls } = await invoke({ query })
  assert.equal(response.statusCode, 404)
  assert.equal(calls.length, 0)
  const duplicate = await invoke({ url: '/api/discovery?path=manufacturing-requests&path=jobs' })
  assert.equal(duplicate.response.statusCode, 404)
  assert.equal(duplicate.calls.length, 0)
})

test('path routing cannot be overridden by client queries or conflicting filesystem metadata', async () => {
  const path = `manufacturing-requests/${id}/specification`
  const otherId = '7069a579-01cf-4a10-a1c2-70e87652acfd'
  for (const options of [
    { url: `/api/discovery/${path}?path=jobs` },
    { url: `/api/discovery/${path}?url=https://evil.example` },
    { url: `/api/discovery/${path}?id=${id}&id=${id}` },
    { url: `/api/discovery/${path}?id=${otherId}` },
    { query: { id: otherId } },
    { query: { id: [id, id] } },
    { query: { id: ':id' } },
    { query: { id: `${id}\n` } },
    { query: { id, path: 'jobs' } },
    { url: `/api/discovery/${path}?id=${otherId}`, query: { id } },
    { url: '/api/discovery/manufacturing-requests', query: { id } },
    { url: '/api/discovery/manufacturing-requests/[id]/specification' },
    { url: `/api/discovery/manufacturing-requests/:id/specification`, query: { id } },
    { url: `/api/discovery/manufacturing-requests/${id}%2Fspecification`, query: { id } },
    { url: `https://evil.example/api/discovery/${path}`, query: { id } },
    { url: `//evil.example/api/discovery/${path}`, query: { id } },
    { url: `/badem-api/api/${path}.js`, query: { id } },
  ]) {
    const { response, calls } = await invoke({ path, ...options })
    assert.equal(response.statusCode, 404, JSON.stringify(options))
    assert.equal(calls.length, 0)
    assert.equal(response.headers['Cache-Control'], 'no-store')
  }
})

for (const [suffix, method, body, file] of [
  [
    `manufacturing-requests/${id}/specification`,
    'POST',
    { process: ['laser_engraving'], materials: ['wood'] },
    'manufacturing-requests/[id]/specification.js',
  ],
  [`manufacturing-requests/${id}/discover`, 'POST', '', 'manufacturing-requests/[id]/discover.js'],
  [`partner-candidates/${id}`, 'GET', '', 'partner-candidates/[id].js'],
]) {
  test(`Vercel rewrite interpolates the real UUID for ${file}`, async () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)))
    const { routes, error } = getTransformedRoutes(config)
    assert.equal(error, null)
    const browserPath = `/badem-api/api/${suffix}`
    const route = routes.find((item) => item.src && new RegExp(item.src).test(browserPath))
    const destination = browserPath.replace(new RegExp(route.src), route.dest)
    assert.equal(destination, `/api/discovery/${suffix}`)
    assert.ok(!destination.includes('?'))
    assert.ok(!destination.includes(':id'))
    const entry = await import(new URL(`../api/discovery/${file}`, import.meta.url))
    assert.equal(typeof entry.default, 'function')
    for (const url of [
      browserPath,
      destination,
      `${destination}?id=${id}`,
      `/api/discovery/${file.slice(0, -3)}?id=${id}`,
      `/api/discovery/${file}?id=${id}`,
    ]) {
      const { response, calls } = await invoke({ url, query: { id }, method, body })
      assert.equal(response.statusCode, 201, url)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, `https://api.badem.network/api/${suffix}`)
      assert.equal(calls[0].headers['X-Admin-Key'], serverKey)
      assert.equal(response.headers['Cache-Control'], 'no-store')
    }
    const withoutMetadata = await invoke({ url: destination, method, body })
    assert.equal(withoutMetadata.response.statusCode, 201)
    assert.equal(withoutMetadata.calls[0].url, `https://api.badem.network/api/${suffix}`)
  })
}

test('proxy rejects unsupported methods, cross-site origins and invalid server configuration', async () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    const { response, calls } = await invoke({ method })
    assert.equal(response.statusCode, 405)
    assert.equal(response.headers.Allow, 'POST')
    assert.equal(calls.length, 0)
  }
  for (const headers of [
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const { response, calls } = await invoke({ headers })
    assert.equal(response.statusCode, 403)
    assert.equal(calls.length, 0)
  }
  for (const origin of [
    undefined,
    'http://api.badem.network',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://user:pass@api.badem.network',
    'https://api.badem.network/path',
    'https://api.badem.network?url=evil',
  ]) {
    const { response, calls } = await invoke({ env: { ...environment, BADEM_API_ORIGIN: origin } })
    assert.equal(response.statusCode, 503)
    assert.equal(calls.length, 0)
  }
  for (const key of [undefined, '', ' ', 'bad\r\nheader']) {
    const { response, calls } = await invoke({
      env: { ...environment, BADEM_SERVER_ADMIN_KEY: key },
    })
    assert.equal(response.statusCode, 503)
    assert.equal(calls.length, 0)
  }
})

test('proxy accepts only the explicit public origins and its configured preview origin', async () => {
  for (const origin of [
    'https://app.badem.network',
    'https://badem.network',
    'https://preview-123.vercel.app',
  ]) {
    const { response } = await invoke({
      env: { ...environment, VERCEL_URL: 'preview-123.vercel.app' },
      headers: { origin },
    })
    assert.equal(response.statusCode, 201)
  }
})

test('proxy bounds and validates input without altering specification JSON', async () => {
  const { response, calls } = await invoke({
    body: { title: 'Name\u0161taj', description: '30 tags' },
  })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(JSON.parse(calls[0].body), { title: 'Name\u0161taj', description: '30 tags' })
  for (const body of [
    '{broken',
    '{"quantity":1e309}',
    '',
    null,
    [],
    { title: 'a'.repeat(65536) },
  ]) {
    const result = await invoke({ body })
    assert.ok([400, 413].includes(result.response.statusCode))
    assert.equal(result.calls.length, 0)
  }
  const oversized = await invoke({ headers: { 'content-length': '65537' } })
  assert.equal(oversized.response.statusCode, 413)
  assert.equal(oversized.calls.length, 0)
  const form = await invoke({ headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  assert.equal(form.response.statusCode, 415)
  const unwanted = await invoke({
    path: `manufacturing-requests/${id}/discover`,
    body: { url: 'https://evil.example' },
  })
  assert.equal(unwanted.response.statusCode, 400)
})

test('proxy handles raw Node request streams and malformed Vercel body getters safely', async () => {
  for (const [body, expected] of [
    ['{"title":"A"}', 201],
    ['{broken', 400],
    ['x'.repeat(65537), 413],
  ]) {
    const request = Object.assign(Readable.from([Buffer.from(body)]), {
      method: 'POST',
      url: '/api/discovery/manufacturing-requests',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${betaToken}` },
      query: {},
    })
    const response = {
      setHeader() {},
      end(value) {
        this.payload = JSON.parse(value)
      },
    }
    const proxy = createDiscoveryProxy({
      env: environment,
      securityFetcher: betaFetcher(),
      fetcher: async () => Response.json({ id }, { status: 201 }),
    })
    await proxy(request, response)
    assert.equal(response.statusCode, expected)
  }
  const request = {
    method: 'POST',
    url: '/api/discovery/manufacturing-requests',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${betaToken}` },
    query: {},
  }
  Object.defineProperty(request, 'body', {
    get() {
      throw new Error('raw internal body failure')
    },
  })
  const response = {
    setHeader() {},
    end(value) {
      this.payload = JSON.parse(value)
    },
  }
  await createDiscoveryProxy({
    env: environment,
    securityFetcher: betaFetcher(),
    fetcher: () => {
      throw new Error('Must not fetch')
    },
  })(request, response)
  assert.equal(response.statusCode, 400)
  assert.ok(!JSON.stringify(response.payload).includes('raw internal'))
})

test('proxy sanitizes errors, redirects, credential echoes and oversized/invalid responses', async () => {
  for (const status of [301, 302, 401, 403, 404, 409, 422, 429, 500, 502, 504]) {
    const { response } = await invoke({
      fetcher: async () => new Response(`internal stack ${serverKey}`, { status }),
    })
    assert.ok(response.statusCode >= 400)
    assert.ok(!JSON.stringify(response.payload).includes(serverKey))
    assert.ok(!JSON.stringify(response.payload).includes('internal stack'))
  }
  for (const responseBody of [
    { debug: serverKey },
    { nested: [{ [serverKey]: true }] },
    { key: `AIza${'x'.repeat(35)}` },
    { large: 'x'.repeat(1048577) },
    null,
    'not-json',
  ]) {
    const { response } = await invoke({
      fetcher: async () =>
        responseBody === 'not-json' ? new Response(responseBody) : Response.json(responseBody),
    })
    assert.equal(response.statusCode, 502)
    assert.ok(!JSON.stringify(response.payload).includes(serverKey))
  }
  const network = await invoke({
    fetcher: async () => {
      throw new Error(`raw failure ${serverKey}`)
    },
  })
  assert.equal(network.response.statusCode, 502)
  assert.ok(!JSON.stringify(network.response.payload).includes(serverKey))
})

test('proxy preserves backend ranking, fit confidence and exact disclaimer', async () => {
  const payload = {
    provider: 'GOOGLE_PLACES',
    candidates: [
      {
        candidate_id: id,
        fit_score: 10,
        confidence: 'low',
        verification_status: 'PUBLIC_DATA_ONLY',
        disclaimer:
          'Potential fit based on public data. Production capability has not been verified.',
      },
    ],
  }
  const { response } = await invoke({
    path: `manufacturing-requests/${id}/discover`,
    body: '',
    fetcher: async () => Response.json(payload),
  })
  assert.deepEqual(response.payload, payload)
})

test('proxy timeout is sanitized and its timers/listeners are released', async () => {
  const { response, calls } = await invoke({
    timeoutMs: 5,
    fetcher: (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('raw timeout', 'AbortError')),
          { once: true },
        )
      }),
  })
  assert.equal(response.statusCode, 504)
  assert.ok(calls[0].signal.aborted)
  assert.equal(response.listenerCount('close'), 0)
})

test('Vercel routes expose the four discovery operations before SPA fallback', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)))
  assert.equal(config.framework, 'vite')
  assert.equal(config.functions['api/discovery/**/*.js'].maxDuration, 120)
  assert.equal(
    config.rewrites.filter(
      (rewrite) =>
        rewrite.destination.startsWith('/api/discovery/') &&
        !rewrite.destination.endsWith('blocked'),
    ).length,
    4,
  )
  assert.equal(config.rewrites.at(-1).destination, '/index.html')
  const spa = new RegExp(`^${config.rewrites.at(-1).source}$`)
  assert.ok(spa.test('/discovery'))
  assert.ok(spa.test('/'))
  assert.ok(!spa.test('/api/proofs'))
  assert.ok(config.rewrites.every((rewrite) => !rewrite.destination.startsWith('http')))
  assert.ok(config.rewrites.every((rewrite) => !rewrite.destination.includes('?')))
  const { routes, error } = getTransformedRoutes(config)
  assert.equal(error, null)
  for (const path of [
    '/badem-api',
    '/badem-api/',
    '/badem-api/api/jobs',
    '/badem-api/api/proofs/anchor',
  ]) {
    const route = routes.find((item) => item.src && new RegExp(item.src).test(path))
    assert.equal(path.replace(new RegExp(route.src), route.dest), '/api/discovery/blocked')
  }
})

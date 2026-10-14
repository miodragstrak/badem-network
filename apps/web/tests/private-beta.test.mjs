import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDiscoveryProxy } from '../server/discovery-proxy.js'
import { createBetaSession } from '../server/beta-session.js'
import { createDiscoveryApi } from '../src/discovery/api.js'
import { browserAuthConfig, isPublishableKey } from '../src/auth/config.js'
import { BETA_INVITE_MESSAGE, BETA_LIMIT_MESSAGE } from '../src/auth/messages.js'
import {
  betaEnvironment,
  betaToken,
  betaFetcher,
  betaUser,
  testToken,
} from './helpers/beta-fixtures.mjs'

const requestId = 'b07127c3-7a8e-44da-b43f-a5fdd2b83d21'
const environment = {
  ...betaEnvironment,
  BADEM_API_ORIGIN: 'https://api.badem.network',
  BADEM_SERVER_ADMIN_KEY: 'beta-backend-unit-key-only',
}

async function invoke({
  path = `manufacturing-requests/${requestId}/discover`,
  method = 'POST',
  body = '',
  headers = {},
  env = environment,
  securityFetcher = betaFetcher(),
  fetcher,
  session = false,
  url,
  timeoutMs,
} = {}) {
  const request = {
    method: session ? 'GET' : method,
    body,
    url: url || (session ? '/badem-api/auth/session' : `/badem-api/api/${path}`),
    headers: {
      authorization: `Bearer ${betaToken}`,
      'content-type': 'application/json',
      ...headers,
    },
  }
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value) {
      this.payload = JSON.parse(value)
    },
  }
  const calls = []
  const proxy = session
    ? createBetaSession({ env, fetcher: securityFetcher, timeoutMs })
    : createDiscoveryProxy({
        env,
        securityFetcher,
        timeoutMs,
        fetcher: async (url, options) => {
          calls.push({ url, ...options })
          return fetcher ? fetcher(url, options) : Response.json({ ok: true })
        },
      })
  await proxy(request, response)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.equal(response.headers['Vercel-CDN-Cache-Control'], 'no-store')
  return { response, calls }
}

test('all four gateway operations deny signed-out requests without provider or backend I/O', async () => {
  for (const [path, method, body] of [
    ['manufacturing-requests', 'POST', { title: 'A' }],
    [`manufacturing-requests/${requestId}/specification`, 'POST', { process: ['laser_engraving'] }],
    [`manufacturing-requests/${requestId}/discover`, 'POST', ''],
    [`partner-candidates/${requestId}`, 'GET', ''],
  ]) {
    const securityCalls = []
    const { response, calls } = await invoke({
      path,
      method,
      body,
      headers: { authorization: undefined },
      securityFetcher: betaFetcher({ calls: securityCalls }),
    })
    assert.equal(response.statusCode, 401)
    assert.equal(response.headers['X-BADEM-Error'], 'SESSION_REQUIRED')
    assert.equal(calls.length, 0)
    assert.equal(securityCalls.length, 0)
  }
})

test('malformed, expired, wrong-project, anonymous and privileged tokens fail closed', async () => {
  for (const authorization of [
    '',
    'Bearer',
    'Basic abc',
    'Bearer abc',
    `Bearer ${betaToken}\r\n`,
    [`Bearer ${betaToken}`],
    `Bearer ${'x'.repeat(8192)}`,
    `Bearer ${testToken({ exp: 0 })}`,
    `Bearer ${testToken({ sub: 'not-a-uuid' })}`,
    `Bearer ${testToken({ iss: 'https://wrong.badem.network/auth/v1' })}`,
    `Bearer ${testToken({ role: 'service_role' })}`,
    `Bearer ${testToken({ role: 'anon' })}`,
    `Bearer ${testToken({ nbf: Math.floor(Date.now() / 1000) + 1000 })}`,
  ]) {
    const securityCalls = []
    const { response, calls } = await invoke({
      headers: { authorization },
      securityFetcher: betaFetcher({ calls: securityCalls }),
    })
    assert.equal(response.statusCode, 401)
    assert.equal(calls.length, 0)
    assert.equal(securityCalls.length, 0)
  }
})

test('token parsing cannot authorize a forged token: Auth must confirm it on every request', async () => {
  for (const status of [401, 403, 404]) {
    const { response, calls } = await invoke({
      securityFetcher: async () => new Response('private Auth error', { status }),
    })
    assert.equal(response.statusCode, 401)
    assert.equal(calls.length, 0)
    assert.ok(!JSON.stringify(response.payload).includes('private Auth'))
  }
  const seen = []
  for (let i = 0; i < 2; i++)
    await invoke({
      path: 'manufacturing-requests',
      body: {},
      securityFetcher: betaFetcher({ calls: seen }),
    })
  assert.equal(seen.length, 2)
  assert.ok(seen.every((call) => call.url === `${betaEnvironment.SUPABASE_URL}/auth/v1/user`))
  assert.ok(
    seen.every(
      (call) =>
        call.headers.apikey === betaEnvironment.SUPABASE_PUBLISHABLE_KEY &&
        call.headers.Authorization === `Bearer ${betaToken}` &&
        call.redirect === 'error',
    ),
  )
})

test('allowlist uses fresh confirmed Auth email, not client email, JWT claims or user metadata', async () => {
  for (const user of [
    {
      ...betaUser,
      email: 'not-invited@example.org',
      user_metadata: { email: betaUser.email, beta: true },
    },
    { ...betaUser, email_confirmed_at: null },
    { ...betaUser, is_anonymous: true },
    { ...betaUser, role: 'service_role' },
    { ...betaUser, id: requestId },
    { ...betaUser, banned_until: '2099-01-01T00:00:00Z' },
  ]) {
    const seen = []
    const { response, calls } = await invoke({
      headers: {
        'x-user-email': betaUser.email,
        authorization: `Bearer ${testToken({ email: betaUser.email })}`,
      },
      securityFetcher: betaFetcher({ user, calls: seen }),
    })
    assert.ok([401, 403].includes(response.statusCode))
    assert.equal(calls.length, 0)
    assert.equal(seen.length, 1)
  }
  for (const allowlist of ['', '*', 'other@example.org']) {
    const { response, calls } = await invoke({
      env: { ...environment, BADEM_BETA_EMAIL_ALLOWLIST: allowlist },
    })
    assert.equal(response.statusCode, 403)
    assert.equal(response.payload.detail, BETA_INVITE_MESSAGE)
    assert.equal(calls.length, 0)
  }
  assert.equal(
    (
      await invoke({
        env: {
          ...environment,
          BADEM_BETA_EMAIL_ALLOWLIST: ' INVITED@EXAMPLE.ORG , other@example.org ',
        },
      })
    ).response.statusCode,
    200,
  )
})

test('only three discover dispatches are allowed across independent gateway instances; reads/saves cost zero', async () => {
  const usage = new Map()
  const seen = []
  const securityFetcher = betaFetcher({
    calls: seen,
    consume: (id) => {
      const count = usage.get(id) || 0
      if (count >= 3) return false
      usage.set(id, count + 1)
      return true
    },
  })
  for (let i = 0; i < 5; i++) {
    for (const [path, method, body] of [
      ['manufacturing-requests', 'POST', {}],
      [`manufacturing-requests/${requestId}/specification`, 'POST', {}],
      [`partner-candidates/${requestId}`, 'GET', ''],
    ])
      assert.equal((await invoke({ path, method, body, securityFetcher })).response.statusCode, 200)
  }
  assert.equal(usage.size, 0)
  for (let i = 0; i < 3; i++) {
    const result = await invoke({ securityFetcher })
    assert.equal(result.response.statusCode, 200)
    assert.equal(result.calls.length, 1)
    assert.equal(result.calls[0].headers['X-Admin-Key'], environment.BADEM_SERVER_ADMIN_KEY)
    assert.equal(result.calls[0].headers.Authorization, undefined)
  }
  const fourth = await invoke({ securityFetcher })
  assert.equal(fourth.response.statusCode, 429)
  assert.equal(fourth.response.payload.detail, BETA_LIMIT_MESSAGE)
  assert.equal(fourth.response.headers['X-BADEM-Error'], 'DISCOVERY_LIMIT')
  assert.equal(fourth.calls.length, 0)
  const rpc = seen.filter((call) => call.url.includes('/rpc/'))
  assert.equal(rpc.length, 4)
  assert.ok(
    rpc.every(
      (call) =>
        call.headers.apikey === betaEnvironment.SUPABASE_SECRET_KEY &&
        !call.headers.Authorization &&
        call.redirect === 'error',
    ),
  )
  assert.ok(
    rpc.every(
      (call) =>
        JSON.stringify(JSON.parse(call.body)) === JSON.stringify({ p_user_id: betaUser.id }),
    ),
  )
  assert.equal(
    (await invoke({ path: `partner-candidates/${requestId}`, method: 'GET', securityFetcher }))
      .response.statusCode,
    200,
  )
  assert.equal(usage.get(betaUser.id), 3)
})

test('quota is reserved before upstream dispatch and errors do not refund ambiguous provider attempts', async () => {
  let count = 0
  const order = []
  const securityFetcher = betaFetcher({
    consume: () => {
      order.push('quota')
      return ++count <= 3
    },
  })
  for (let i = 0; i < 3; i++) {
    const result = await invoke({
      securityFetcher,
      fetcher: async () => {
        order.push('backend')
        throw new Error('upstream failed')
      },
    })
    assert.equal(result.response.statusCode, 502)
  }
  assert.deepEqual(order, ['quota', 'backend', 'quota', 'backend', 'quota', 'backend'])
  const fourth = await invoke({ securityFetcher })
  assert.equal(fourth.response.statusCode, 429)
  assert.equal(fourth.calls.length, 0)
})

test('Auth/usage outages, redirects, malformed responses and missing configuration never bypass protection', async () => {
  for (const fetcher of [
    async () => new Response('secret diagnostic', { status: 503 }),
    async () => new Response('redirect', { status: 302 }),
    async () => new Response('{broken'),
    async () => Response.json({ padding: 'x'.repeat(16385) }),
    async () => {
      throw new Error(environment.BADEM_SERVER_ADMIN_KEY)
    },
  ]) {
    const result = await invoke({ securityFetcher: fetcher })
    assert.equal(result.response.statusCode, 503)
    assert.equal(result.calls.length, 0)
    assert.ok(!JSON.stringify(result.response.payload).includes('secret'))
  }
  for (const value of [null, {}, [], 'true', 1]) {
    const result = await invoke({
      securityFetcher: async (url) => Response.json(url.endsWith('/user') ? betaUser : value),
    })
    assert.equal(result.response.statusCode, 503)
    assert.equal(result.calls.length, 0)
  }
  for (const env of [
    { ...environment, SUPABASE_URL: 'http://localhost:54321' },
    { ...environment, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_a_publishable_key' },
    { ...environment, SUPABASE_SECRET_KEY: '' },
    { ...environment, SUPABASE_SERVICE_ROLE_KEY: 'also-configured' },
  ]) {
    const result = await invoke({ env })
    assert.equal(result.response.statusCode, 503)
    assert.equal(result.calls.length, 0)
  }
})

test('session-check endpoint authenticates/allowlists without Render calls or quota consumption', async () => {
  const seen = []
  const result = await invoke({ session: true, securityFetcher: betaFetcher({ calls: seen }) })
  assert.equal(result.response.statusCode, 200)
  assert.deepEqual(result.response.payload, { user: { id: betaUser.id, email: betaUser.email } })
  assert.equal(seen.length, 1)
  assert.equal(result.calls.length, 0)
  for (const options of [
    { headers: { authorization: undefined }, expected: 401 },
    { env: { ...environment, BADEM_BETA_EMAIL_ALLOWLIST: '' }, expected: 403 },
    { url: '/badem-api/auth/session?token=abc', expected: 404 },
    { url: '/badem-api/auth/anything', expected: 404 },
    { headers: { origin: 'https://evil.example' }, expected: 403 },
  ])
    assert.equal(
      (await invoke({ session: true, ...options })).response.statusCode,
      options.expected,
    )
})

test('backend responses cannot echo privileged Supabase keys', async () => {
  for (const body of [
    { key: betaEnvironment.SUPABASE_SECRET_KEY },
    { [betaEnvironment.SUPABASE_SECRET_KEY]: true },
  ]) {
    const result = await invoke({ fetcher: async () => Response.json(body) })
    assert.equal(result.response.statusCode, 502)
    assert.ok(
      !JSON.stringify(result.response.payload).includes(betaEnvironment.SUPABASE_SECRET_KEY),
    )
  }
})

test('client sends a refreshed identity token, never admin auth, and distinguishes quota 429 from provider 429', async () => {
  let token = 'session-one'
  const seen = []
  const api = createDiscoveryApi({
    adminKey: 'never-forward',
    baseUrl: 'https://wrong.example.org',
    getAccessToken: async () => token,
    fetcher: async (url, options) => {
      seen.push({ url, ...options })
      return Response.json({ ok: true })
    },
  })
  await api.discover(requestId)
  token = 'session-two'
  await api.getProfile(requestId)
  assert.deepEqual(
    seen.map((call) => call.headers.Authorization),
    ['Bearer session-one', 'Bearer session-two'],
  )
  assert.ok(
    seen.every((call) => !('X-Admin-Key' in call.headers) && call.url.startsWith('/badem-api/')),
  )
  for (const code of ['DISCOVERY_LIMIT', undefined]) {
    const limited = createDiscoveryApi({
      getAccessToken: async () => token,
      fetcher: async () =>
        new Response('private debug', {
          status: 429,
          headers: code ? { 'X-BADEM-Error': code } : {},
        }),
    })
    await assert.rejects(
      limited.discover(requestId),
      (error) =>
        error.status === 429 &&
        (code ? error.message === BETA_LIMIT_MESSAGE : error.message !== BETA_LIMIT_MESSAGE),
    )
  }
  let calls = 0
  const signedOut = createDiscoveryApi({
    fetcher: async () => {
      ++calls
    },
  })
  await assert.rejects(signedOut.discover(requestId), (error) => error.status === 401)
  assert.equal(calls, 0)
})

test('browser auth configuration accepts only public keys, never privileged keys', () => {
  assert.ok(
    browserAuthConfig({
      url: betaEnvironment.SUPABASE_URL,
      key: betaEnvironment.SUPABASE_PUBLISHABLE_KEY,
    }),
  )
  assert.ok(isPublishableKey(testToken({ role: 'anon' })))
  for (const key of ['', 'sb_secret_any_privileged_key', testToken({ role: 'service_role' })]) {
    assert.equal(isPublishableKey(key), false)
    assert.equal(browserAuthConfig({ url: betaEnvironment.SUPABASE_URL, key }), null)
  }
})

test('Auth/usage timeouts stop dispatch; legacy service-role keys and array audiences work', async () => {
  for (const blockedStage of ['auth', 'quota']) {
    const result = await invoke({
      timeoutMs: 10,
      securityFetcher: async (url, { signal }) => {
        if (blockedStage === 'quota' && url.endsWith('/user')) return Response.json(betaUser)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('fixture timeout')), {
            once: true,
          })
        })
      },
    })
    assert.equal(result.response.statusCode, 504)
    assert.equal(result.calls.length, 0)
  }
  const legacy = testToken({ role: 'service_role' })
  const calls = []
  const result = await invoke({
    env: { ...environment, SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: legacy },
    headers: { authorization: `Bearer ${testToken({ aud: ['authenticated'] })}` },
    securityFetcher: betaFetcher({ calls }),
  })
  assert.equal(result.response.statusCode, 200)
  const rpc = calls.find((call) => call.url.includes('/rpc/'))
  assert.equal(rpc.headers.apikey, legacy)
  assert.equal(rpc.headers.Authorization, `Bearer ${legacy}`)
})

test('client access callbacks distinguish session/invite failures from origin rejection', async () => {
  for (const [status, code, shouldInvalidate] of [
    [401, '', true],
    [403, 'BETA_INVITE_REQUIRED', true],
    [403, '', false],
    [429, 'DISCOVERY_LIMIT', false],
  ]) {
    const invalidated = []
    const api = createDiscoveryApi({
      getAccessToken: async () => 'fixture-token',
      onAccessError: (value) => invalidated.push(value),
      fetcher: async () =>
        new Response('private details', { status, headers: { 'X-BADEM-Error': code } }),
    })
    await assert.rejects(
      api.discover(requestId),
      (error) => error.status === status && !error.message.includes('private details'),
    )
    assert.deepEqual(invalidated, shouldInvalidate ? [status] : [])
  }
})

test('gateway injects only the freshly verified user identity and ignores spoofed browser headers', async () => {
  const other = { ...betaUser, id: requestId, email: 'other-beta@example.org' }
  for (const user of [betaUser, other]) {
    for (const [path, method, body] of [
      ['manufacturing-requests', 'POST', { title: 'A' }],
      [
        `manufacturing-requests/${requestId}/specification`,
        'POST',
        { process: ['laser_engraving'], materials: ['wood'] },
      ],
      [`manufacturing-requests/${requestId}/discover`, 'POST', ''],
      [`partner-candidates/${requestId}`, 'GET', ''],
    ]) {
      const result = await invoke({
        path,
        method,
        body,
        env: { ...environment, BADEM_BETA_EMAIL_ALLOWLIST: `${betaUser.email},${other.email}` },
        headers: {
          authorization: `Bearer ${testToken({ sub: user.id })}`,
          'x-badem-user-id': user.id === betaUser.id ? other.id : betaUser.id,
          'x-admin-key': 'browser-forged-admin-key',
        },
        securityFetcher: betaFetcher({ user }),
      })
      assert.equal(result.response.statusCode, 200)
      assert.equal(result.calls[0].headers['X-BADEM-User-Id'], user.id)
      assert.equal(result.calls[0].headers['X-Admin-Key'], environment.BADEM_SERVER_ADMIN_KEY)
      assert.equal(result.calls[0].headers.Authorization, undefined)
      assert.equal(result.calls[0].headers['x-badem-user-id'], undefined)
    }
  }
})

test('owner selection is rejected at the gateway and backend foreign-object 404s remain private', async () => {
  for (const [path, body] of [
    ['manufacturing-requests', { title: 'A', owner_user_id: requestId }],
    [
      `manufacturing-requests/${requestId}/specification`,
      { process: ['laser_engraving'], materials: ['wood'], owner_user_id: requestId },
    ],
  ]) {
    const securityCalls = []
    const result = await invoke({
      path,
      body,
      securityFetcher: betaFetcher({ calls: securityCalls }),
    })
    assert.equal(result.response.statusCode, 400)
    assert.equal(result.calls.length, 0)
    assert.equal(securityCalls.length, 0)
  }
  for (const [path, method, body] of [
    [`manufacturing-requests/${requestId}/specification`, 'POST', {}],
    [`manufacturing-requests/${requestId}/discover`, 'POST', ''],
    [`partner-candidates/${requestId}`, 'GET', ''],
  ]) {
    const result = await invoke({
      path,
      method,
      body,
      fetcher: async () =>
        Response.json({ detail: 'Private foreign object data' }, { status: 404 }),
    })
    assert.equal(result.response.statusCode, 404)
    assert.deepEqual(result.response.payload, {
      detail: 'The BADEM service is temporarily unavailable.',
    })
    assert.equal(result.calls[0].headers['X-BADEM-User-Id'], betaUser.id)
  }
})

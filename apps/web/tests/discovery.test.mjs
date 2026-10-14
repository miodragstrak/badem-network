import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDiscoveryApi, DiscoveryError } from '../src/discovery/api.js'
import { betaToken } from './helpers/beta-fixtures.mjs'
import {
  humanize,
  INITIAL_REQUEST,
  prefillSpecification,
  requestPayload,
  specificationPayload,
  validateRequest,
  validateSpecification,
} from '../src/discovery/forms.js'

test('request validation rejects whitespace, fractions and unsafe quantities', () => {
  assert.deepEqual(validateRequest(INITIAL_REQUEST), {})
  assert.deepEqual(
    Object.keys(validateRequest({ title: ' ', description: '', location: '', quantity: '0' })),
    ['title', 'description', 'location', 'quantity'],
  )
  for (const quantity of ['2.5', '-1', 'NaN', '9007199254740992', ''])
    assert.ok(validateRequest({ ...INITIAL_REQUEST, quantity }).quantity)
  assert.ok(validateRequest({ ...INITIAL_REQUEST, title: 'a'.repeat(121) }).title)
  assert.deepEqual(requestPayload(INITIAL_REQUEST), {
    title: INITIAL_REQUEST.title,
    description: INITIAL_REQUEST.description,
    location_text: 'Belgrade, Serbia',
    quantity: 30,
  })
})

test('specification prefill copies explicit quantity/location without parsing prose', () => {
  const specification = prefillSpecification(INITIAL_REQUEST)
  assert.equal(specification.quantity, '30')
  assert.equal(specification.city, 'Belgrade')
  assert.equal(specification.country, 'RS')
  assert.equal(specification.width, '')
  assert.equal(specification.requirements, '')
  assert.deepEqual(validateSpecification(specification), {})
  assert.deepEqual(specificationPayload(specification), {
    process: ['laser_engraving'],
    materials: ['plywood'],
    quantity: 30,
    requirements: [],
    location: { city: 'Belgrade', country: 'RS' },
  })
})

test('manual dimensions, custom material and requirements produce API JSON', () => {
  const values = {
    ...prefillSpecification(INITIAL_REQUEST),
    material: 'other',
    customMaterial: ' Brass ',
    width: '50',
    height: '50',
    thickness: '3',
    requirements: ' engraved logo \n\n rounded edges ',
    country: 'Serbia',
  }
  assert.deepEqual(validateSpecification(values), {})
  assert.deepEqual(specificationPayload(values), {
    process: ['laser_engraving'],
    materials: ['Brass'],
    quantity: 30,
    dimensions_mm: { width: 50, height: 50, thickness: 3 },
    requirements: ['engraved logo', 'rounded edges'],
    location: { city: 'Belgrade', country: 'RS' },
  })
  assert.ok(validateSpecification({ ...values, customMaterial: ' ' }).customMaterial)
  for (const width of ['-3', 'Infinity', '0', 'NaN'])
    assert.ok(validateSpecification({ ...values, width }).width)
  assert.ok(validateSpecification({ ...values, requirements: 'a'.repeat(501) }).requirements)
  assert.ok(
    validateSpecification({ ...values, requirements: Array(101).fill('a').join('\n') })
      .requirements,
  )
})

test('all required process/material options are accepted', () => {
  const base = prefillSpecification(INITIAL_REQUEST)
  for (const process of [
    'laser_engraving',
    'laser_cutting',
    'cnc_machining',
    '3d_printing',
    'prototyping',
  ])
    assert.deepEqual(validateSpecification({ ...base, process }), {})
  for (const material of ['plywood', 'wood', 'metal', 'plastic', 'acrylic', 'other'])
    assert.deepEqual(validateSpecification({ ...base, material, customMaterial: 'Brass' }), {})
  assert.equal(specificationPayload({ ...base, city: '', country: '' }).location, undefined)
  assert.equal(humanize('LISTED_OPERATIONAL'), 'Listed operational')
  assert.equal(humanize('medium'), 'Medium')
  assert.equal(humanize('PUBLIC_DATA_ONLY').toUpperCase(), 'PUBLIC DATA ONLY')
})

test('client uses session identity and the same ordered discovery endpoints', async () => {
  const calls = []
  const api = createDiscoveryApi({
    baseUrl: '/test-api/',
    adminKey: 'test-only',
    getAccessToken: async () => betaToken,
    fetcher: async (url, options) => {
      calls.push({ url, ...options })
      return { ok: true, json: async () => ({ id: 'request/1', candidates: [] }) }
    },
  })
  await api.createRequest(requestPayload(INITIAL_REQUEST))
  await api.saveSpecification(
    'request/1',
    specificationPayload(prefillSpecification(INITIAL_REQUEST)),
  )
  await api.discover('request/1')
  await api.getProfile('candidate/1')
  assert.deepEqual(
    calls.map(({ url, method }) => [url, method]),
    [
      ['/badem-api/api/manufacturing-requests', 'POST'],
      ['/badem-api/api/manufacturing-requests/request%2F1/specification', 'POST'],
      ['/badem-api/api/manufacturing-requests/request%2F1/discover', 'POST'],
      ['/badem-api/api/partner-candidates/candidate%2F1', 'GET'],
    ],
  )
  assert.ok(calls.every((call) => call.headers.Authorization === `Bearer ${betaToken}`))
  assert.ok(calls.every((call) => !('X-Admin-Key' in call.headers)))
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.equal(calls[2].body, undefined)
})

test('API rankings and zero results are returned unchanged, without client fixtures', async () => {
  for (const candidates of [
    [],
    [
      { candidate_id: 'second', fit_score: 60 },
      { candidate_id: 'first', fit_score: 60 },
    ],
  ]) {
    const result = { provider: 'GOOGLE_PLACES', candidates }
    const api = createDiscoveryApi({
      getAccessToken: async () => betaToken,
      fetcher: async () => ({ ok: true, json: async () => result }),
    })
    assert.equal(await api.discover('r'), result)
  }
})

test('provider, authentication and save failures never expose response details or fake data', async () => {
  for (const status of [401, 403, 404, 409, 422, 500, 502, 504]) {
    const api = createDiscoveryApi({
      getAccessToken: async () => betaToken,
      fetcher: async () => ({
        ok: false,
        status,
        json: () => {
          throw new Error('secret should never be read')
        },
      }),
    })
    await assert.rejects(
      api.discover('r'),
      (error) =>
        error instanceof DiscoveryError &&
        error.status === status &&
        !/secret|Google|stack/i.test(error.message),
    )
  }
  const api = createDiscoveryApi({
    getAccessToken: async () => betaToken,
    fetcher: async () => {
      throw new Error('internal network information')
    },
  })
  await assert.rejects(api.createRequest(requestPayload(INITIAL_REQUEST)), /entries are preserved/)
  await assert.rejects(api.getProfile('c'), /profile could not be loaded/)
})

test('cancellation propagates to fetch and a timeout becomes a retryable error', async () => {
  const fetcher = (url, options) =>
    new Promise((resolve, reject) => {
      if (options.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })
  const api = createDiscoveryApi({ fetcher, timeoutMs: 10, getAccessToken: async () => betaToken })
  await assert.rejects(api.discover('r'), /specification is preserved/)
  const controller = new AbortController()
  const pending = api.discover('r', controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

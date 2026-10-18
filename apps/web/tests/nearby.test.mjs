import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { applyResolvedLocation, editLocation, getDeviceLocation, manualLocation, usableCoordinates } from '../src/discovery/location.js'
import { createDiscoveryApi } from '../src/discovery/api.js'
import { betaToken } from './helpers/beta-fixtures.mjs'
import { INITIAL_REQUEST, prefillSpecification, requestPayload, specificationPayload, validateSpecification } from '../src/discovery/forms.js'
import { evidenceSummary, formatDistance, matchLabel } from '../src/discovery/presentation.js'
import { browserMapsConfig, createPartnerMap } from '../src/discovery/maps.js'

test('device coordinates are requested explicitly and reach only the specification payload', async () => {
  let calls = 0
  const geo = { getCurrentPosition(success, failure, options) {
    calls++
    assert.deepEqual(options, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 })
    success({ coords: { latitude: 44.074, longitude: 22.095 } })
  } }
  assert.equal(calls, 0)
  const point = await getDeviceLocation(geo)
  assert.equal(calls, 1)
  const request = { ...INITIAL_REQUEST, location: 'Current location', ...point }
  assert.equal(JSON.stringify(requestPayload(request)).includes('44.074'), false)
  const values = prefillSpecification(request)
  assert.deepEqual(validateSpecification(values), {})
  assert.deepEqual(specificationPayload(values).location, { display_name: 'Current location', ...point })
  assert.equal(values.city, '')
  assert.equal(values.country, '')
})

for (const [code, message] of [[1, /permission was denied/], [2, /unavailable/], [3, /timed out/]]) {
  test(`geolocation error ${code} preserves manual entry and does not expose provider messages`, async () => {
    await assert.rejects(getDeviceLocation({ getCurrentPosition(success, fail) { fail({ code, message: 'private provider text' }) } }), message)
    const edited = editLocation(INITIAL_REQUEST, 'Bor, Serbia')
    const payload = specificationPayload(prefillSpecification(edited))
    assert.deepEqual(payload.location, { display_name: 'Bor, Serbia', city: 'Bor', country: 'RS' })
    assert.equal(usableCoordinates(edited), null)
  })
}

test('unsupported, invalid and cancelled location requests are safe', async () => {
  await assert.rejects(getDeviceLocation(null), /unavailable/)
  await assert.rejects(getDeviceLocation({ getCurrentPosition(ok) { ok({ coords: { latitude: NaN, longitude: 1 } }) } }), /could not be determined/)
  const controller = new AbortController()
  let success
  const pending = getDeviceLocation({ getCurrentPosition(callback) { success = callback } }, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  success({ coords: { latitude: 1, longitude: 2 } })
  let called = false
  await assert.rejects(getDeviceLocation({ getCurrentPosition() { called = true } }, controller.signal), { name: 'AbortError' })
  assert.equal(called, false)
})

test('editing location clears device geometry, while manual city/country and zero coordinates remain valid', () => {
  const original = { ...INITIAL_REQUEST, latitude: 44, longitude: 22 }
  const edited = editLocation(original, 'Bor, RS')
  assert.equal(usableCoordinates(edited), null)
  assert.deepEqual(specificationPayload(prefillSpecification(edited)).location, { display_name: 'Bor, RS', city: 'Bor', country: 'RS' })
  assert.deepEqual(manualLocation('Bor'), { city: 'Bor', country: '' })
  assert.deepEqual(usableCoordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 })
  for (const value of [undefined, {}, { latitude: true, longitude: 2 }, { latitude: 0, longitude: '1' }, { latitude: 0, longitude: 181 }]) {
    assert.equal(usableCoordinates(value), null)
  }
  assert.ok(validateSpecification({ ...prefillSpecification(INITIAL_REQUEST), latitude: 1 }).location)
})

test('manual Belgrade is resolved through the existing specification save and retained for rediscovery', async () => {
  const canonical = { display_name: 'Belgrade, Serbia', city: 'Belgrade', country: 'RS', country_code: 'RS',
    latitude: 44.7866, longitude: 20.4489 }
  const calls = []
  const api = createDiscoveryApi({ getAccessToken: async () => betaToken, fetcher: async (url, options) => {
    calls.push({ url, ...options })
    return { ok: true, json: async () => url.endsWith('/specification')
      ? { payload: { location: canonical } } : { candidates: [] } }
  } })
  const values = prefillSpecification(INITIAL_REQUEST)
  const payload = specificationPayload(values)
  assert.deepEqual(payload.location, { display_name: 'Belgrade, Serbia', city: 'Belgrade', country: 'RS' })
  const saved = await api.saveSpecification('request', payload)
  const resolved = applyResolvedLocation(values, saved.payload.location)
  assert.deepEqual(usableCoordinates(resolved), { latitude: 44.7866, longitude: 20.4489 })
  assert.equal(resolved.location, 'Belgrade, Serbia')
  assert.deepEqual(validateSpecification(resolved), {})
  assert.deepEqual(specificationPayload(resolved).location, {
    display_name: canonical.display_name, city: canonical.city, country: canonical.country,
    latitude: canonical.latitude, longitude: canonical.longitude,
  })
  await api.discover('request')
  assert.deepEqual(calls.map(({ url }) => url), [
    '/badem-api/api/manufacturing-requests/request/specification',
    '/badem-api/api/manufacturing-requests/request/discover',
  ])
  assert.ok(calls.every(({ headers }) => headers.Authorization === `Bearer ${betaToken}`))
  assert.equal(usableCoordinates(editLocation(resolved, 'Novi Sad, Serbia')), null)
})

test('failed manual resolution preserves text fallback and still allows discovery', async () => {
  const values = prefillSpecification(INITIAL_REQUEST)
  const fallback = specificationPayload(values)
  const calls = []
  const api = createDiscoveryApi({ getAccessToken: async () => betaToken, fetcher: async (url) => {
    calls.push(url)
    return { ok: true, json: async () => url.endsWith('/specification') ? { payload: fallback } : { candidates: [] } }
  } })
  const saved = await api.saveSpecification('request', fallback)
  const unchanged = applyResolvedLocation(values, saved.payload.location)
  assert.equal(unchanged, values)
  assert.deepEqual(specificationPayload(unchanged), fallback)
  assert.deepEqual(validateSpecification(unchanged), {})
  assert.deepEqual(await api.discover('request'), { candidates: [] })
  assert.equal(calls.length, 2)
})

test('a specification response never replaces browser geolocation coordinates or label', () => {
  const values = prefillSpecification({ ...INITIAL_REQUEST, location: 'Current location', latitude: 0, longitude: 0 })
  const returned = { display_name: 'Other location', city: 'Belgrade', country: 'RS', latitude: 44, longitude: 20 }
  assert.equal(applyResolvedLocation(values, returned), values)
  assert.deepEqual(specificationPayload(values).location, { display_name: 'Current location', latitude: 0, longitude: 0 })
})

test('distance formatting is straight-line, nullable and human readable', () => {
  for (const [input, expected] of [[0, '0.0 km'], [.24, '0.2 km'], [9.21, '9.2 km'], [10, '10 km'], [25.7, '26 km'], [1000, '1,000 km']]) {
    assert.equal(formatDistance(input), expected)
  }
  for (const invalid of [null, undefined, NaN, Infinity, -1, '3', false]) assert.equal(formatDistance(invalid), null)
})

test('simple match labels preserve backend semantics without modifying scores or claiming verification', () => {
  for (const [fit_label, expected] of [['Strong potential fit', 'Strong potential match'], ['Potential fit', 'Potential match'],
    ['Possible fit', 'Possible match'], ['Low-confidence fit', 'Possible match'], ['unknown', 'Possible match']]) {
    const candidate = Object.freeze({ fit_label, fit_score: 77 })
    assert.equal(matchLabel(candidate), expected)
    assert.equal(candidate.fit_score, 77)
  }
  const specification = prefillSpecification(INITIAL_REQUEST)
  assert.equal(evidenceSummary({ score_breakdown: { process_match: 40 } }, specification), 'Public business data suggests laser engraving.')
  assert.equal(evidenceSummary({ score_breakdown: { material_signal: 20, process_match: 0 } }, specification),
    'Wood-related manufacturing signal found. Laser engraving is not confirmed.')
  assert.match(evidenceSummary({ score_breakdown: { process_match: 20 } }, specification), /not confirmed/)
  assert.match(evidenceSummary({ score_breakdown: { location_suitability: 10, public_activity_signal: 5 } }, specification), /No matching manufacturing signal/)
})

test('browser Maps configuration is explicit, restricted-key shaped and cannot reuse the configured server key', () => {
  const key = `AIza${'m'.repeat(35)}`
  assert.deepEqual(browserMapsConfig({ key, mapId: 'public_map_id' }), { key, mapId: 'public_map_id' })
  for (const input of [{}, { key }, { key: 'server-secret', mapId: 'public_map_id' }, { key, mapId: 'invalid?map' },
    { key, mapId: 'public_map_id', serverKey: key }]) assert.equal(browserMapsConfig(input), null)
})

test('markers retain list numbering, synchronize selection, omit invalid geometry and clean up', () => {
  const document = globalThis.document
  const markers = []
  const selections = []
  class Element extends EventTarget {
    children = []
    classes = new Set()
    classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) }
    append(child) { this.children.push(child) }
    replaceChildren() { this.children = [] }
  }
  class Map {
    constructor(element, options) { this.options = options; element.map = this }
    fitBounds() { this.fitted = true }
    panTo(position) { this.panned = position }
    setCenter(position) { this.centered = position }
  }
  const maps = { Map, LatLngBounds: class { extend() {} }, marker: { AdvancedMarkerElement: class extends Element {
    constructor(options) { super(); Object.assign(this, options); markers.push(this) }
  } }, event: { clearInstanceListeners(map) { map.cleared = true } } }
  globalThis.document = { createElement: () => new Element() }
  try {
    const element = new Element()
    const candidates = [{ candidate_id: 'missing', name: 'No coordinates' }, { candidate_id: 'a', name: 'Workshop A', latitude: 0, longitude: 0 },
      { candidate_id: 'b', name: 'Workshop B', latitude: 1, longitude: 1 }, { candidate_id: 'bad', latitude: 100, longitude: 1 }]
    const adapter = createPartnerMap({ maps, element, candidates, mapId: 'public_map_id', onSelect: (...args) => selections.push(args), reducedMotion: true })
    assert.equal(markers.length, 2)
    assert.equal(markers[0].children[0].textContent, '2')
    assert.equal(markers[1].children[0].textContent, '3')
    adapter.select('b')
    assert.equal(markers[1].children[0].classes.has('selected'), true)
    assert.match(markers[1].title, /selected/)
    assert.deepEqual(element.map.centered, { lat: 1, lng: 1 })
    assert.equal(element.map.panned, undefined)
    markers[0].dispatchEvent(new Event('gmp-click'))
    assert.deepEqual(selections, [['a', 'map']])
    adapter.select('a')
    assert.equal(markers[1].children[0].classes.has('selected'), false)
    adapter.destroy()
    assert.ok(markers.every((marker) => marker.map === null))
    markers[0].dispatchEvent(new Event('gmp-click'))
    assert.equal(selections.length, 1)
    assert.equal(element.map.cleared, true)
  } finally {
    if (document === undefined) delete globalThis.document
    else globalThis.document = document
  }
})

test('empty, sparse and missing-distance result views render honestly without a map key or browser secrets', async () => {
  const server = await createServer({ configFile: false, envFile: false, root: new URL('../', import.meta.url).pathname,
    define: { 'import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY': '""', 'import.meta.env.VITE_GOOGLE_MAPS_MAP_ID': '""' },
    server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { default: Results } = await server.ssrLoadModule('/src/discovery/PartnerResults.jsx')
    const candidate = { candidate_id: 'a', name: 'Wood workshop', fit_label: 'Low-confidence fit', fit_score: 30,
      score_breakdown: { material_signal: 20 }, disclaimer: 'Potential fit based on public data. Production capability has not been verified.' }
    const render = (candidates) => renderToStaticMarkup(createElement(Results, {
      result: { candidates, provider: 'GOOGLE_PLACES' }, specification: prefillSpecification(INITIAL_REQUEST), onProfile() {},
    }))
    assert.match(render([]), /couldn&#x27;t find a relevant manufacturing partner nearby/)
    const sparse = render([candidate])
    assert.match(sparse, /1 potential partner found/)
    assert.match(sparse, /Possible match/)
    assert.match(sparse, /PUBLIC DATA ONLY/)
    assert.match(sparse, /No workshop coordinates available/)
    assert.match(sparse, /aria-pressed="true"/)
    assert.ok(!sparse.includes('/100'))
    assert.ok(!sparse.includes('Straight-line distance:'))
    assert.match(render([{ ...candidate, distance_km: 4.2, latitude: 44, longitude: 22 }]), /Straight-line distance: 4.2 km/)
    assert.match(render([{ ...candidate, latitude: 44, longitude: 22 }]), /Map unavailable/)
    assert.match(render([candidate, { ...candidate, candidate_id: 'b' }]), /2 potential partners found/)
  } finally {
    await server.close()
  }
})

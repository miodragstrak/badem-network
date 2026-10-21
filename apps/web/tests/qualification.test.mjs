import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  PUBLIC_DATA_DISCLAIMER, PUBLIC_DATA_STATUS, publicPartnerDetails, publicPhone,
  publicWebsite, qualificationEvidence, qualificationMatchSummary,
} from '../src/discovery/qualification.js'

const profile = {
  candidate_id: 'workshop-a', name: 'Public workshop fixture', fit_label: 'Potential fit', fit_score: 65,
  confidence: 'medium', distance_km: 4.27, verification_status: PUBLIC_DATA_STATUS,
  disclaimer: PUBLIC_DATA_DISCLAIMER, phone: '+12025550123',
  score_breakdown: { process_match: 40, material_signal: 20, equipment_signal: 0, business_specialization: 5,
    location_suitability: 0, public_activity_signal: 0 },
  partner_profile: {
    location_summary: 'Bor, RS', phone: '+12025550123',
    signals: { material_signals: ['wood', 'plywood'], equipment_signals: [],
      specialization_signals: ['manufacturer', 'establishment', 'point_of_interest'] },
    inferred_capabilities: [{ capability: 'laser_engraving', confidence: .75,
      evidence: ["business name contains 'laser engraving'"] }],
    enrichment: { status: 'ENRICHED', public_evidence: { website_present: true, rating_present: true,
      business_operational_signal: 'LISTED_OPERATIONAL', public_activity_signal_strength: 'ESTABLISHED' } },
  },
}

for (const [value, href] of [['https://workshop.example', 'https://workshop.example/'],
  ['http://workshop.example/contact', 'http://workshop.example/contact'],
  ['  HTTPS://workshop.example/contact?ref=public#info  ', 'https://workshop.example/contact?ref=public#info']]) {
  test(`safe website link: ${value}`, () => assert.equal(publicWebsite(value).href, href))
}

for (const value of [undefined, null, false, true, 42, {}, '', 'not-a-url', '//workshop.example',
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
  'file:///private', 'ftp://workshop.example', 'mailto:shop@example.org', 'tel:+12025550123',
  'https://', 'https:///workshop.example', 'https:workshop.example', 'https://.',
  'https://user:password@workshop.example', 'https://work shop.example', 'https://work\nshop.example',
  'https://workshop.example\\@evil.example', `https://workshop.example/${'x'.repeat(2048)}`]) {
  test(`unsafe or missing website rejected: ${String(value).slice(0, 90)}`, () => assert.equal(publicWebsite(value), null))
}

test('phone links consume the backend value without client normalization or country inference', () => {
  for (const value of ['+12025550123', '0111234567']) assert.deepEqual(publicPhone(value), { label: value, href: `tel:${value}` })
  for (const value of [undefined, null, '', 1234567, false, ' +12025550123', '+12025550123\n', 'call now',
    '+1 202 555 0123', 'javascript:alert(1)', '+12+345678', 'tel:0111234567', '12']) assert.equal(publicPhone(value), null)
})

test('legacy API coarse flags never become a website URL, numeric rating, review count or full address', () => {
  const details = publicPartnerDetails(profile)
  assert.equal(details.website, null)
  assert.equal(details.websitePresent, true)
  assert.equal(details.rating, null)
  assert.equal(details.reviewCount, null)
  assert.equal(details.address, '')
  assert.equal(details.location, 'Bor, RS')
  assert.equal(details.businessStatus, 'Listed operational')
  assert.equal(details.activity, 'Established public listing activity')
  for (const value of ['__proto__', 'constructor', 'UNKNOWN', true, {}]) {
    const sparse = { business_status: value, partner_profile: { enrichment: { public_evidence: { public_activity_signal_strength: value } } } }
    assert.equal(publicPartnerDetails(sparse).businessStatus, '')
    assert.equal(publicPartnerDetails(sparse).activity, '')
  }
})

test('qualification uses only documented manufacturing signals and does not mutate backend scores', () => {
  const before = structuredClone(profile)
  const rows = qualificationEvidence(profile)
  assert.deepEqual(rows.map(row => row.label), ['Process', 'Material', 'Specialization'])
  assert.match(rows[0].items[0].label, /Laser engraving \(public inference\)/)
  assert.deepEqual(rows[0].items[0].evidence, ["business name contains 'laser engraving'"])
  assert.ok(!JSON.stringify(rows).includes('manufacturer'))
  assert.ok(!JSON.stringify(rows).includes('point_of_interest'))
  assert.ok(!JSON.stringify(rows).includes('Equipment'))
  assert.deepEqual(profile, before)
  const materialsOnly = { ...profile, score_breakdown: { material_signal: 20, process_match: 0, business_specialization: 0 },
    partner_profile: { ...profile.partner_profile, signals: { material_signals: ['wood'], equipment_signals: ['3d_printer'] } } }
  assert.deepEqual(qualificationEvidence(materialsOnly).map(row => row.label), ['Material'])
  assert.ok(!JSON.stringify(qualificationEvidence(materialsOnly)).toLowerCase().includes('laser'))
  assert.deepEqual(qualificationEvidence({ name: 'Laser engraving CNC Wood', score_breakdown: { location_suitability: 10, public_activity_signal: 5 } }), [])
  assert.deepEqual(qualificationEvidence({ score_breakdown: { process_match: 40, equipment_signal: 15 }, partner_profile: { inferred_capabilities: [{ capability: 'laser_engraving', evidence: [] }] } }), [])
  assert.deepEqual(qualificationEvidence({ score_breakdown: { equipment_signal: 15 }, partner_profile: { signals: { equipment_signals: ['laser'] } } })[0].label, 'Equipment')
})

test('Match Summary uses recorded category coverage without inventing signals or numeric capability percentages', () => {
  const before = structuredClone(profile)
  const summary = qualificationMatchSummary(profile)
  assert.deepEqual(summary.map(({ label, status }) => [label, status]), [
    ['Process', 'Signal found'], ['Material', 'Signal found'], ['Equipment', 'No public signal'], ['Specialization', 'Partial signal'],
  ])
  assert.deepEqual(summary[2].signals, [])
  assert.deepEqual(summary[3].signals, []) // Generic listing types are not specialization claims.
  assert.deepEqual(profile, before)
  const partial = { ...profile, score_breakdown: { process_match: 20, material_signal: 10, equipment_signal: 5 },
    partner_profile: { ...profile.partner_profile, signals: { material_signals: ['wood'], equipment_signals: ['laser'] } } }
  assert.deepEqual(qualificationMatchSummary(partial).map(row => row.state), ['partial', 'partial', 'partial', 'none'])
  assert.deepEqual(qualificationMatchSummary({ ...profile, score_breakdown: {} }).map(row => row.state), ['none', 'none', 'none', 'none'])
  assert.deepEqual(qualificationMatchSummary({ score_breakdown: { process_match: 40, material_signal: 20 } })
    .map(row => row.state), ['none', 'none', 'none', 'none'])
})

test('location, public activity, business-name text and unrelated process inferences do not become match evidence', () => {
  const sparse = { name: 'Laser engraving furniture CNC', score_breakdown: { location_suitability: 10, public_activity_signal: 5 },
    partner_profile: { signals: { specialization_signals: ['manufacturer'], review_keyword_signals: ['laser'], website_signal: true } } }
  assert.ok(qualificationMatchSummary(sparse).every(row => row.state === 'none' && row.signals.length === 0))
  const woodOnly = { ...profile, score_breakdown: { process_match: 0, material_signal: 20 },
    partner_profile: { ...profile.partner_profile, signals: { material_signals: ['wood'] } } }
  assert.deepEqual(qualificationMatchSummary(woodOnly).map(row => row.state), ['none', 'found', 'none', 'none'])
  const nested = { partner_profile: { ...profile.partner_profile, score_breakdown: profile.score_breakdown } }
  assert.deepEqual(qualificationMatchSummary(nested), qualificationMatchSummary(profile))
})

let server
let Qualification
let Profile
before(async () => {
  server = await createServer({ configFile: false, envFile: false, root: new URL('../', import.meta.url).pathname,
    server: { middlewareMode: true, ws: false }, appType: 'custom' })
  Qualification = (await server.ssrLoadModule('/src/discovery/PartnerQualification.jsx')).default
  Profile = (await server.ssrLoadModule('/src/discovery/PartnerProfile.jsx')).default
})
after(async () => { await server?.close() })
const render = (data) => renderToStaticMarkup(createElement(Qualification, { data }))
const primary = (data) => render(data).split('<details')[0]

test('legacy phone-only profile renders without unsupported contact or rating fields', () => {
  const html = render(profile)
  assert.match(html, /href="tel:\+12025550123"/)
  assert.match(html, /Call workshop/)
  assert.match(html, /\+12025550123/)
  assert.match(html, /4.3 km straight-line distance/)
  assert.match(html, /Bor, RS/)
  assert.match(html, /Listed operational/)
  assert.match(html, /Why this may be a match/)
  assert.match(html, /numeric rating not provided/)
  assert.match(html, /website is listed, but its URL is not available/)
  assert.ok(!html.includes('Visit website'))
  assert.ok(!html.includes('Public review count'))
  assert.ok(!primary(profile).includes('65/100'))
})

test('safe supplied website renders an external action with safe rel, without changing the supplied phone', () => {
  const html = render({ ...profile, website: 'https://workshop.example/contact', address: 'Example workshop address', rating: 4.7, review_count: 1234 })
  assert.match(html, /href="https:\/\/workshop.example\/contact" target="_blank" rel="noopener noreferrer"/)
  assert.match(html, /referrerPolicy="no-referrer"/i)
  assert.match(html, /Visit website/)
  assert.match(html, /Example workshop address/)
  assert.match(html, /Public rating/)
  assert.match(html, /4.7 \/ 5/)
  assert.match(html, /1,234/)
  assert.match(html, /Public business activity, not production capability or product quality\./)
  const qualification = html.split('id="qualification-evidence-title"')[1].split('</section>')[0]
  assert.ok(!qualification.includes('4.7'))
  assert.ok(!qualification.includes('1,234'))
})

test('normalized V1.3A backend qualification contract renders contacts and public context without changing evidence', () => {
  const fields = { website: 'https://workshop.example/contact?ref=public', phone: '+12025550123',
    address: '12, Workshop Road, Bor, Serbia', business_status: 'CLOSED_TEMPORARILY',
    rating: 4.7, review_count: 83, distance_km: 4.27 }
  for (const data of [{ ...profile, ...fields, partner_profile: { ...profile.partner_profile, ...fields } },
    { ...profile, partner_profile: { ...profile.partner_profile, ...fields } }]) {
    const html = render(data)
    assert.match(html, /Visit website/)
    assert.match(html, /Call workshop/)
    assert.match(html, /Listed temporarily closed/)
    assert.match(html, /12, Workshop Road, Bor, Serbia/)
    assert.match(html, /4.7 \/ 5/)
    assert.match(html, /Public review count<\/dt><dd>83<\/dd>/)
    assert.deepEqual(qualificationEvidence(data), qualificationEvidence(profile))
  }
})

test('unsafe website values and absent or unusable phone never render actionable links', () => {
  for (const website of ['javascript:alert(1)', 'data:text/html,bogus', 'file:///private', 'malformed', true, null]) {
    const html = render({ ...profile, website, phone: null, partner_profile: {} })
    assert.ok(!html.includes('Visit website'))
    assert.ok(!html.includes('Call workshop'))
    assert.ok(!html.includes('href="'))
    assert.match(html, /No public contact links are available/)
  }
  const html = render({ ...profile, phone: 'javascript:bad', partner_profile: {} })
  assert.ok(!html.includes('tel:'))
})

test('missing data is omitted cleanly, and rating/review count zero and invalid values are not fabricated', () => {
  const html = render({ fit_label: 'Low-confidence fit', partner_profile: {} })
  assert.match(html, /Possible match/)
  assert.equal((primary({}).match(/No public signal/g) || []).length, 4)
  assert.ok(!html.includes('Undefined'))
  for (const absent of ['Call workshop', 'Visit website', 'straight-line distance', 'Public rating', 'Public review count']) assert.ok(!html.includes(absent))
  assert.match(render({ review_count: 0, partner_profile: {} }), /Public review count<\/dt><dd>0<\/dd>/)
  for (const [rating, review_count] of [[false, false], ['4.7', '12'], [NaN, 1.5], [6, -1], [Infinity, Infinity]]) {
    const output = render({ rating, review_count, partner_profile: {} })
    assert.ok(!output.includes('Public rating'))
    assert.ok(!output.includes('Public review count'))
  }
})

test('contact actions and nonduplicated rating context precede the primary Match Summary', () => {
  const data = { ...profile, website: 'https://workshop.example', address: 'Public workshop address', rating: 4.7, review_count: 83 }
  const html = render(data)
  const top = primary(data)
  const matchStart = top.indexOf('Why this may be a match')
  for (const field of ['Public workshop address', '4.3 km', 'workshop.example', '+12025550123',
    'Listed operational', 'Public rating', 'Public review count', 'Visit website', 'Call workshop']) {
    assert.ok(top.indexOf(field) >= 0 && top.indexOf(field) < matchStart, field)
  }
  for (const token of ['<dt>Public rating</dt>', '<dt>Public review count</dt>', '<dd>4.7 / 5</dd>', '<dd>83</dd>']) {
    assert.equal(html.split(token).length - 1, 1, token)
  }
  for (const removed of ['Recorded process inferences', 'Recorded public signals', 'Public listing enrichment', 'Fit reasoning', 'Public-signal score:']) {
    assert.ok(!top.includes(removed))
  }
})

test('primary summary has readable qualitative states, no score meter or numeric capability percentage', () => {
  const html = primary(profile)
  assert.match(html, /Why this may be a match/)
  assert.match(html, /Match Summary/)
  assert.equal((html.match(/class="discovery-match-summary-row"/g) || []).length, 4)
  assert.match(html, /aria-labelledby="match-summary-title"/)
  assert.match(html, /Public signals for this request, not verified capability\./)
  assert.match(html, /data-state="none"><dt>Equipment<\/dt>/)
  assert.ok(!html.includes('<meter'))
  assert.ok(!html.includes('65/100'))
  assert.ok(!/\d+(?:\.\d+)?\s*%/.test(html))
  assert.ok(!html.includes("business name contains"))
})

test('one Technical details disclosure is collapsed by default and retains the original technical evidence', () => {
  const data = { ...profile, reasoning: ['Original fit reasoning retained.'], partner_profile: {
    ...profile.partner_profile, signals: { ...profile.partner_profile.signals,
      review_keyword_signals: ['public_keyword'], laser_related_name: true, public_activity_signal: true, website_signal: true },
    enrichment: { ...profile.partner_profile.enrichment, signals: ['website_present', 'operational_listing', 'public_activity'] },
  } }
  const html = render(data)
  assert.equal((html.match(/<details\b/g) || []).length, 1)
  assert.match(html, /<summary>Technical details<\/summary>/)
  assert.ok(!/<details[^>]*\bopen(?:[\s=>])/.test(html))
  const technical = html.slice(html.indexOf('<details'))
  for (const retained of ['65/100', 'Fit confidence: Medium', 'Process match', 'Location suitability',
    'Public activity signal', 'Materials', 'Equipment signals', 'Business specialization', 'Laser engraving',
    'Public keyword', "business name contains &#x27;laser engraving&#x27;", 'Manufacturer',
    'Enrichment status', 'Enriched', 'Website present', 'Operational listing', 'Established',
    'Listed operational', 'Original fit reasoning retained.']) {
    assert.ok(technical.includes(retained), retained)
  }
  assert.equal((technical.match(/<meter\b/g) || []).length, 6)
})

test('PUBLIC_DATA_ONLY and the exact disclaimer stay visible in the modal even while a profile is loading', () => {
  const html = renderToStaticMarkup(createElement(Profile, { candidate: profile, api: { getProfile() { throw new Error('SSR must not fetch') } }, onClose() {} }))
  assert.match(html, /Partner qualification/)
  assert.match(html, /Public workshop fixture/)
  assert.ok(html.includes(PUBLIC_DATA_STATUS))
  assert.ok(html.includes(PUBLIC_DATA_DISCLAIMER))
  assert.ok(!html.includes('65/100'))
})

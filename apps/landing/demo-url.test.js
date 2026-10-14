import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDemoUrl } from './demo-url.js'
import { proofDemoUrl } from './src/app-links.js'

for (const candidate of [
  undefined, '', '   ', 'not a URL', '/demo', '//demo.badem.network',
  'http://demo.badem.network', 'javascript:alert(1)',
  'http://localhost:5173', 'https://localhost:5173', 'https://LOCALHOST.',
  'https://demo.localhost', 'https://localhost.localdomain', 'https://127.0.0.1', 'https://127.1',
  'https://2130706433', 'https://0x7f000001', 'https://[::1]',
  'https://[::ffff:127.0.0.1]', 'https://[::127.0.0.1]',
  'https://0.0.0.0', 'https://10.0.0.1', 'https://192.168.1.2',
  'https://172.16.0.1', 'https://169.254.1.1', 'https://100.64.0.1',
  'https://[fd00::1]', 'https://[fe80::1]', 'https://[fec0::1]', 'https://demo.local',
  'https://demo.home.arpa', 'https://demo', 'https://demo.invalid',
  'https://demo.test', 'https://demo_internal.badem.network',
  'https://user:password@demo.badem.network',
]) {
  test(`production rejects ${candidate ?? 'missing configuration'}`, () => {
    assert.equal(resolveDemoUrl(candidate, true), '')
  })
}

for (const candidate of [
  'https://demo.badem.network', ' https://demo.badem.network/path?mode=debug#proof ',
  'https://demo.badem.network.', 'https://localhost.badem.network',
  'https://8.8.8.8', 'https://[2001:4860:4860::8888]',
]) {
  test(`production accepts ${candidate.trim()}`, () => {
    assert.equal(resolveDemoUrl(candidate, true), new URL(candidate.trim()).href)
  })
}

test('development preserves the local demo CTA', () => {
  assert.equal(resolveDemoUrl(' http://localhost:5173 ', false), 'http://localhost:5173')
})

test('development without a demo URL uses the prototype fallback', () => {
  assert.equal(resolveDemoUrl(undefined, false), '')
})

test('Proof CTA uses the configured app origin and the /proof route', () => {
  for (const value of [
    'https://app.badem.network',
    'https://app.badem.network/',
    'https://app.badem.network/discovery?mode=debug#prototype',
  ]) assert.equal(proofDemoUrl(resolveDemoUrl(value, true)), 'https://app.badem.network/proof')
  assert.equal(proofDemoUrl(resolveDemoUrl('http://localhost:5173', false)), 'http://localhost:5173/proof')
})

test('Proof CTA remains hidden for missing or rejected production app URLs', () => {
  for (const value of [undefined, '', 'not a URL', 'http://localhost:5173', 'https://127.0.0.1', 'javascript:alert(1)']) {
    assert.equal(proofDemoUrl(resolveDemoUrl(value, true)), '')
  }
  assert.equal(proofDemoUrl('not a URL'), '')
  assert.equal(proofDemoUrl('javascript:alert(1)'), '')
})

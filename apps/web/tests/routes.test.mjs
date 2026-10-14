import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { getTransformedRoutes } from '@vercel/routing-utils'
import { APP_PATHS, resolveAppRoute } from '../src/routes.js'

for (const [route, path] of Object.entries(APP_PATHS)) {
  test(`${path} resolves to ${route} and supports direct Vercel refresh`, () => {
    assert.equal(resolveAppRoute(path), route)
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)))
    const { routes, error } = getTransformedRoutes(config)
    assert.equal(error, null)
    const rewrite = routes.find((item) => item.src && new RegExp(item.src).test(path))
    assert.equal(path.replace(new RegExp(rewrite.src), rewrite.dest), '/index.html')
    if (path !== '/') assert.equal(resolveAppRoute(`${path}/`), route)
  })
}

test('Proof modes stay on /proof and cannot select a different app route', () => {
  for (const search of ['?mode=debug', '?mode=fallback', '?job_id=example&proof_id=example']) {
    const url = new URL(`/proof${search}`, 'https://app.badem.network')
    assert.equal(resolveAppRoute(url.pathname), 'proof')
    assert.equal(url.search, search)
  }
  assert.equal(resolveAppRoute('/'), 'home')
  for (const path of [
    '/unknown',
    '/discovery/extra',
    '/proof/extra',
    '/badem-api/api/jobs',
    '/api/discovery',
    '//proof',
    undefined,
  ]) {
    assert.equal(resolveAppRoute(path), 'not-found')
  }
})

test('app metadata uses BADEM and the original landing brand mark', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('<title>BADEM &mdash; Manufacturing Network</title>'))
  assert.ok(
    html.includes(
      'content="Discover production partners and verify physical manufacturing with BADEM."',
    ),
  )
  assert.ok(html.includes('content="#172e27"'))
  assert.ok(!html.includes('cube-depin'))
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
  assert.equal(pkg.name, 'badem-web')
  assert.equal(lock.name, pkg.name)
  assert.equal(lock.packages[''].name, pkg.name)
  assert.deepEqual(
    readFileSync(new URL('../public/favicon.svg', import.meta.url)),
    readFileSync(new URL('../../landing/public/favicon.svg', import.meta.url)),
  )
})

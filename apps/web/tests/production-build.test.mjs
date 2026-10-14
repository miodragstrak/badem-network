import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function artifactText(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return artifactText(path)
      return /\.(html|js|css|json|svg|txt)$/.test(entry.name) ? readFileSync(path, 'utf8') : ''
    })
    .join('\n')
}

test(
  'both production builds exclude credential canaries, unknown VITE variables and localhost',
  { timeout: 60000 },
  () => {
    const temp = mkdtempSync(join(tmpdir(), 'badem-build-security-'))
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const canaries = {
      VITE_BADEM_ADMIN_KEY: 'dev-admin-build-canary-only',
      BADEM_ADMIN_KEY: 'backend-admin-build-canary-only',
      BADEM_SERVER_ADMIN_KEY: 'proxy-admin-build-canary-only',
      GOOGLE_PLACES_API_KEY: `AIza${'g'.repeat(35)}`,
      SOLANA_PAYER_PRIVATE_KEY: 'payer-build-canary-only',
      SUPABASE_SECRET_KEY: 'sb_secret_server_build_canary_only',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-build-canary-only',
      VITE_SUPABASE_SECRET_KEY: 'sb_secret_vite_build_canary_only',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'vite-service-role-build-canary-only',
      BADEM_BETA_EMAIL_ALLOWLIST: 'allowlist-build-canary-only@example.org',
      VITE_UNRELATED_SECRET: 'unknown-vite-build-canary-only',
    }
    try {
      const publicKey = 'sb_publishable_browser_build_fixture_only'
      const privilegedJwt = [
        Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
        Buffer.from(JSON.stringify({ role: 'service_role', marker: 'privileged-public-key-build-canary' })).toString('base64url'),
        'fixture-signature-only',
      ].join('.')
      for (const [label, app, key] of [
        ['web-invalid-public-key', 'web', 'sb_secret_wrongly_configured_public_key_canary'],
        ['landing', 'landing', 'sb_secret_wrongly_configured_public_key_canary'],
        ['web-valid-public-key', 'web', publicKey],
        ['web-privileged-jwt', 'web', privilegedJwt],
      ]) {
        const cwd = join(root, app)
        const output = join(temp, label)
        const result = spawnSync(
          process.execPath,
          [
            join(cwd, 'node_modules/vite/bin/vite.js'),
            'build',
            '--mode',
            'development',
            '--outDir',
            output,
            '--emptyOutDir',
          ],
          {
            cwd,
            timeout: 45000,
            encoding: 'utf8',
            env: {
              ...process.env,
              ...canaries,
              NODE_ENV: 'development',
              VITE_BADEM_API_URL: 'http://localhost:8000',
              VITE_DEMO_URL: 'http://localhost:5173',
              VITE_SUPABASE_URL: 'https://beta.badem.network',
              VITE_SUPABASE_PUBLISHABLE_KEY: key,
            },
          },
        )
        assert.equal(result.status, 0, `${app}: security canary build failed`)
        const bundle = artifactText(output)
        if (key === publicKey) assert.ok(bundle.includes(publicKey), 'Configured publishable key should reach the Auth client')
        else assert.ok(!bundle.includes(key), `${label}: privileged value configured as public key must be stripped`)
        for (const value of Object.values(canaries))
          assert.ok(!bundle.includes(value), `${app}: credential canary found in artifact`)
        assert.ok(
          !/http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/.test(bundle),
          `${app}: local URL found in artifact`,
        )
        assert.ok(
          !/AIza[\w-]{35}/.test(bundle),
          `${app}: Google key-shaped string found in artifact`,
        )
        if (app === 'web') {
          assert.ok(!bundle.toLowerCase().includes('x-badem-user-id'), 'Internal identity header must not enter browser code')
          assert.ok(
            !bundle.includes('BADEM_SERVER_ADMIN_KEY'),
            'Server code must not enter browser artifacts',
          )
          assert.ok(
            !bundle.includes('BADEM_API_ORIGIN'),
            'Server origin configuration must not enter browser artifacts',
          )
        }
      }
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  },
)

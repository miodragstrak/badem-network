export const betaUser = {
  id: '7d210ad9-3c1e-4b65-af95-a749924b39f0',
  email: 'invited@example.org',
  role: 'authenticated',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  is_anonymous: false,
}

export const betaEnvironment = {
  SUPABASE_URL: 'https://beta.badem.network',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_test_fixture_only',
  SUPABASE_SECRET_KEY: 'sb_secret_unit_test_fixture_only',
  BADEM_BETA_EMAIL_ALLOWLIST: betaUser.email,
}

export function testToken(overrides = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: betaUser.id,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${betaEnvironment.SUPABASE_URL}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  })}.fixture-signature-not-a-real-token`
}

export const betaToken = testToken()

export function betaFetcher({ user = betaUser, consume = () => true, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url, ...options })
    if (url.endsWith('/auth/v1/user')) return Response.json(user)
    if (url.endsWith('/rest/v1/rpc/consume_badem_discovery'))
      return Response.json(await consume(JSON.parse(options.body).p_user_id))
    throw new Error('Unexpected security endpoint')
  }
}

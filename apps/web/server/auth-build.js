export function explicitAuthOrigin(url) {
  return {
    name: 'badem-explicit-auth-origin',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@supabase/auth-js/dist/module/lib/constants.js'))
        return
      const declaration = this.parse(code).body.find(
        (node) =>
          node.type === 'ExportNamedDeclaration' &&
          node.declaration?.declarations?.some((item) => item.id.name === 'GOTRUE_URL'),
      )
      const value = declaration?.declaration.declarations.find(
        (item) => item.id.name === 'GOTRUE_URL',
      )?.init
      if (!value || value.type !== 'Literal' || value.value !== 'http://localhost:9999') {
        throw new Error('Review the SDK Auth default origin before building.')
      }
      // The SDK's test default is never an app fallback; configured clients always use Supabase HTTPS.
      const origin = url ? `${url}/auth/v1` : 'https://auth.invalid/auth/v1'
      return {
        code: code.slice(0, value.start) + JSON.stringify(origin) + code.slice(value.end),
        map: null,
      }
    },
  }
}

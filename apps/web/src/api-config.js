export function browserApiConfig({
  production = import.meta.env?.PROD || false,
  baseUrl = import.meta.env?.VITE_BADEM_API_URL || '/badem-api',
  adminKey = import.meta.env?.DEV ? import.meta.env.VITE_BADEM_ADMIN_KEY || '' : '',
} = {}) {
  if (import.meta.env?.PROD || production) {
    return { production: true, baseUrl: '/badem-api', adminKey: '' }
  }
  return { production: false, baseUrl, adminKey }
}

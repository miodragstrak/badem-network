export function browserApiConfig({
  production = import.meta.env?.PROD || false,
  baseUrl = import.meta.env?.VITE_BADEM_API_URL || '/badem-api',
} = {}) {
  if (import.meta.env?.PROD || production) {
    return { production: true, baseUrl: '/badem-api', adminKey: '' }
  }
  return { production: false, baseUrl, adminKey: '' }
}

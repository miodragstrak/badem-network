import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { browserAuthConfig } from './src/auth/config.js'
import { apiOrigin } from './server/gateway-http.js'
import { privateBetaDevPlugin } from './server/private-beta-dev.js'
import { explicitAuthOrigin } from './server/auth-build.js'

export default defineConfig(({ command, mode, isPreview }) => {
  const production = command === 'build' || isPreview || mode === 'production'
  const local = loadEnv(mode, import.meta.dirname, '')
  const auth = browserAuthConfig({
    url: apiOrigin(local.VITE_SUPABASE_URL),
    key: local.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  })
  const publicValues = {
    VITE_BADEM_API_URL: production ? '/badem-api' : local.VITE_BADEM_API_URL || '/badem-api',
    VITE_BADEM_ADMIN_KEY: '',
    VITE_SUPABASE_URL: auth?.url || '',
    VITE_SUPABASE_PUBLISHABLE_KEY: auth?.key || '',
    VITE_BADEM_JOB_ID: production ? '' : local.VITE_BADEM_JOB_ID || '',
    VITE_BADEM_PROOF_ID: production ? '' : local.VITE_BADEM_PROOF_ID || '',
    VITE_BADEM_NODE_ID: production ? '' : local.VITE_BADEM_NODE_ID || '',
    VITE_BADEM_PROOF_HASH: production ? '' : local.VITE_BADEM_PROOF_HASH || '',
  }

  return {
    plugins: [
      react(),
      explicitAuthOrigin(auth?.url),
      ...(!production ? [privateBetaDevPlugin(local)] : []),
    ],
    // Never let automatic VITE_* exposure include credentials or unknown variables.
    envPrefix: [],
    define: {
      ...Object.fromEntries(
        Object.entries(publicValues).map(([key, value]) => [
          `import.meta.env.${key}`,
          JSON.stringify(value),
        ]),
      ),
      'import.meta.env.PROD': JSON.stringify(production),
      'import.meta.env.DEV': JSON.stringify(!production),
    },
    preview: { proxy: {} },
  }
})

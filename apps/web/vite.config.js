import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'

export default defineConfig(({ command, mode, isPreview }) => {
  const production = command === 'build' || isPreview || mode === 'production'
  const local = loadEnv(mode, import.meta.dirname, 'VITE_BADEM_')
  const publicValues = {
    VITE_BADEM_API_URL: production ? '/badem-api' : local.VITE_BADEM_API_URL || '/badem-api',
    VITE_BADEM_ADMIN_KEY: production ? '' : local.VITE_BADEM_ADMIN_KEY || '',
    VITE_BADEM_JOB_ID: production ? '' : local.VITE_BADEM_JOB_ID || '',
    VITE_BADEM_PROOF_ID: production ? '' : local.VITE_BADEM_PROOF_ID || '',
    VITE_BADEM_NODE_ID: production ? '' : local.VITE_BADEM_NODE_ID || '',
    VITE_BADEM_PROOF_HASH: production ? '' : local.VITE_BADEM_PROOF_HASH || '',
  }

  return {
    plugins: [react()],
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
    server: {
      proxy: production
        ? {}
        : {
            '/badem-api': {
              target: env.BADEM_API_PROXY_TARGET || 'http://127.0.0.1:8000',
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/badem-api/, ''),
            },
          },
    },
  }
})

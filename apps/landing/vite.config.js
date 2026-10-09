import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveDemoUrl } from './demo-url.js'

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_DEMO_URL')
  const production = command === 'build' || isPreview || mode === 'production'

  return {
    plugins: [react()],
    // Sanitize before replacement so rejected URLs never enter the production bundle.
    define: { 'import.meta.env.VITE_DEMO_URL': JSON.stringify(resolveDemoUrl(env.VITE_DEMO_URL, production)) },
  }
})

import { createClient } from '@supabase/supabase-js'
import { browserAuthConfig } from './config.js'

let client

export function getBrowserAuthClient() {
  if (client !== undefined) return client
  const config = browserAuthConfig()
  client = config
    ? createClient(config.url, config.key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null
  return client
}

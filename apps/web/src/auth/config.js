export function isPublishableKey(value) {
  if (typeof value !== 'string' || value.length > 8192) return false
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return true
  try {
    const parts = value.split('.')
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'
  } catch {
    return false
  }
}

export function browserAuthConfig({
  url = import.meta.env?.VITE_SUPABASE_URL || '',
  key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || '',
} = {}) {
  if (!url || !isPublishableKey(key)) return null
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return null
    return { url: parsed.origin, key }
  } catch {
    return null
  }
}

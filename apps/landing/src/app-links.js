export function proofDemoUrl(appUrl) {
  if (!appUrl) return ''
  try {
    const app = new URL(appUrl)
    if (!['http:', 'https:'].includes(app.protocol)) return ''
    return new URL('/proof', app).href
  } catch {
    return ''
  }
}

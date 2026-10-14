export const APP_PATHS = {
  home: '/',
  discovery: '/discovery',
  proof: '/proof',
}

export function resolveAppRoute(pathname) {
  const path = pathname === '/' ? pathname : pathname?.replace(/\/$/, '')
  return Object.keys(APP_PATHS).find((route) => APP_PATHS[route] === path) || 'not-found'
}

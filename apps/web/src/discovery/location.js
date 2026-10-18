export function usableCoordinates(location) {
  const { latitude, longitude } = location || {}
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null
}

export function manualLocation(value) {
  const [city = '', ...parts] = value.split(',')
  const country = parts.join(',').trim()
  return { city: city.trim(), country: /^(serbia|srbija|rs)$/i.test(country) ? 'RS' : country }
}

export function editLocation(values, location) {
  return { ...values, location, ...manualLocation(location), latitude: null, longitude: null }
}

export function applyResolvedLocation(values, location) {
  const point = usableCoordinates(location)
  if (usableCoordinates(values) || !point) return values
  return { ...values, location: location.display_name || values.location,
    city: location.city || values.city, country: location.country || values.country, ...point }
}

export function locationLabel(values) {
  return values.location?.trim() || [values.city, values.country].filter(Boolean).join(', ') || 'Location not specified'
}

export function getDeviceLocation(geolocation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    const finish = (callback, value) => {
      signal?.removeEventListener('abort', abort)
      if (!signal?.aborted) callback(value)
    }
    if (signal?.aborted) return abort()
    if (!geolocation?.getCurrentPosition) {
      reject(new Error('Location sharing is unavailable. Enter your city and country instead.'))
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const point = usableCoordinates(position?.coords)
          finish(point ? resolve : reject, point || new Error('Your location could not be determined. Enter it manually instead.'))
        },
        (error) => finish(reject, new Error(error?.code === 1
          ? 'Location permission was denied. Enter your city and country instead.'
          : error?.code === 3
            ? 'Location sharing timed out. Enter your location manually or try again.'
            : 'Your location is unavailable. Enter your city and country instead.')),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      )
    } catch {
      finish(reject, new Error('Location sharing is unavailable. Enter your city and country instead.'))
    }
  })
}

import { usableCoordinates } from './location.js'

export function browserMapsConfig({ key = '', mapId = '', serverKey = '' } = {}) {
  return /^AIza[A-Za-z0-9_-]{35}$/.test(key) && key !== serverKey && /^[A-Za-z0-9_-]{1,128}$/.test(mapId)
    ? { key, mapId } : null
}

let loading

export function loadGoogleMaps(config) {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = setTimeout(fail, 15000)
    function fail() {
      clearTimeout(timer)
      script.remove()
      // A late SDK callback after a timeout is harmless; no stale map is created.
      window.__bademMapsReady = () => {}
      reject(new Error('Map unavailable'))
    }
    const previousAuthFailure = window.gm_authFailure
    window.gm_authFailure = () => {
      previousAuthFailure?.()
      window.dispatchEvent(new Event('badem-map-auth-failure'))
      fail()
    }
    window.__bademMapsReady = () => {
      clearTimeout(timer)
      if (window.google?.maps?.Map && window.google?.maps?.marker?.AdvancedMarkerElement) resolve(window.google.maps)
      else fail()
    }
    const parameters = new URLSearchParams({ key: config.key, callback: '__bademMapsReady',
      loading: 'async', libraries: 'marker', v: 'weekly', auth_referrer_policy: 'origin' })
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters}`
    script.async = true
    script.referrerPolicy = 'origin'
    script.onerror = fail
    document.head.append(script)
  }).catch((error) => {
    loading = undefined
    throw error
  })
  return loading
}

// Only public workshop positions enter this adapter. Never pass a customer's point.
export function createPartnerMap({ maps, element, candidates, mapId, onSelect, reducedMotion = false }) {
  const located = candidates.flatMap((candidate, index) => {
    const point = usableCoordinates(candidate)
    return point ? [{ candidate, rank: index + 1, position: { lat: point.latitude, lng: point.longitude } }] : []
  })
  if (!located.length) return null
  const map = new maps.Map(element, { center: located[0].position, zoom: 12, mapId,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'cooperative',
    clickableIcons: false })
  const bounds = new maps.LatLngBounds()
  const markers = located.map(({ candidate, rank, position }) => {
    bounds.extend(position)
    const pin = document.createElement('span')
    pin.className = 'discovery-map-pin'
    pin.textContent = String(rank)
    const check = document.createElement('span')
    check.className = 'discovery-map-pin-check'
    check.textContent = '\u2713'
    pin.append(check)
    const marker = new maps.marker.AdvancedMarkerElement({ map, position, title: `${rank}. ${candidate.name}`, gmpClickable: true })
    marker.append(pin)
    const click = () => onSelect(candidate.candidate_id, 'map')
    marker.addEventListener('gmp-click', click)
    return { marker, pin, click, id: candidate.candidate_id, position, title: `${rank}. ${candidate.name}` }
  })
  if (located.length > 1) map.fitBounds(bounds, 48)
  return {
    select(id, focus = true) {
      for (const item of markers) {
        const selected = item.id === id
        item.pin.classList.toggle('selected', selected)
        item.marker.title = `${item.title}${selected ? ', selected' : ''}`
        item.marker.zIndex = selected ? 100 : 1
        if (selected && focus) {
          if (reducedMotion) map.setCenter(item.position)
          else map.panTo(item.position)
        }
      }
    },
    destroy() {
      for (const { marker, click } of markers) {
        marker.removeEventListener('gmp-click', click)
        marker.map = null
      }
      maps.event.clearInstanceListeners(map)
      element.replaceChildren()
    },
  }
}

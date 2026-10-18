import { useEffect, useRef, useState } from 'react'
import { Loader2, Map, MapPinOff } from 'lucide-react'
import { usableCoordinates } from './location.js'
import { browserMapsConfig, createPartnerMap, loadGoogleMaps } from './maps.js'

const config = browserMapsConfig({ key: import.meta.env?.VITE_GOOGLE_MAPS_BROWSER_KEY,
  mapId: import.meta.env?.VITE_GOOGLE_MAPS_MAP_ID })

export default function PartnerMap({ candidates, selectedId, onSelect }) {
  const [status, setStatus] = useState('loading')
  const canvas = useRef(null)
  const instance = useRef(null)
  const selection = useRef(selectedId)
  const count = candidates.filter(usableCoordinates).length
  useEffect(() => {
    if (!config || !count) return
    let cancelled = false
    const fail = () => { if (!cancelled) setStatus('error') }
    window.addEventListener('badem-map-auth-failure', fail)
    loadGoogleMaps(config).then((maps) => {
      if (cancelled) return
      instance.current = createPartnerMap({ maps, element: canvas.current, candidates, mapId: config.mapId,
        onSelect, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
      instance.current?.select(selection.current, false)
      setStatus('ready')
    }).catch(fail)
    return () => {
      cancelled = true
      window.removeEventListener('badem-map-auth-failure', fail)
      instance.current?.destroy()
      instance.current = null
    }
  }, [candidates, count, onSelect])

  useEffect(() => {
    selection.current = selectedId
    instance.current?.select(selectedId)
  }, [selectedId])

  const unavailable = !config || !count || status === 'error'
  const selected = candidates.find((candidate) => candidate.candidate_id === selectedId)
  return (
    <aside className="discovery-map" aria-labelledby="workshop-map-title">
      <header><h2 id="workshop-map-title"><Map aria-hidden="true" /> Workshop locations</h2>
        <span>{count} of {candidates.length} located</span></header>
      <div id="workshop-map" className="discovery-map-surface">
        <div ref={canvas} className="discovery-map-canvas" aria-label="Workshop map" role="region" hidden={unavailable} />
        {(unavailable || status === 'loading') && (
          <div className="discovery-map-message" role="status">
            {!unavailable ? <Loader2 className="spin" aria-hidden="true" /> : <MapPinOff aria-hidden="true" />}
            <strong>{!count ? 'No workshop coordinates available' : unavailable ? 'Map unavailable' : 'Loading workshop map...'}</strong>
            {unavailable && <p>All potential partners are available in the list.</p>}
          </div>
        )}
      </div>
      <footer>
        <span>Distances are straight-line estimates.</span>
        {selected && <span>{usableCoordinates(selected) ? `Selected: ${selected.name}` : `${selected.name} has no map coordinates.`}</span>}
      </footer>
    </aside>
  )
}

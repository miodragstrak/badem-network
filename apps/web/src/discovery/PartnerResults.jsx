import { useCallback, useRef, useState } from 'react'
import { ArrowRight, Check, MapPin, Search } from 'lucide-react'
import { locationLabel, usableCoordinates } from './location.js'
import { evidenceSummary, formatDistance, matchLabel } from './presentation.js'
import PartnerMap from './PartnerMap.jsx'

export default function PartnerResults({ result, specification, onProfile }) {
  const [selectedId, setSelectedId] = useState(result.candidates[0]?.candidate_id || '')
  const buttons = useRef(new Map())
  const select = useCallback((id, source) => {
    setSelectedId(id)
    if (source === 'map') {
      const button = buttons.current.get(id)
      button?.focus({ preventScroll: true })
      button?.closest('article')?.scrollIntoView({ block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }, [])
  const candidates = result.candidates
  const near = usableCoordinates(specification) ? 'near' : 'for'
  const place = locationLabel(specification) === 'Current location' ? 'your location' : locationLabel(specification)
  return (
    <section className="discovery-nearby" aria-labelledby="nearby-title">
      <header className="discovery-nearby-heading">
        <div><h2 id="nearby-title">Potential workshops {near} {place}</h2>
          <p role="status">{candidates.length} potential {candidates.length === 1 ? 'partner' : 'partners'} found</p></div>
        <span>{result.provider === 'MOCK_PUBLIC_DATA' ? 'Fictional mock public data' : 'Google Places public data'}</span>
      </header>
      {candidates.length ? (
        <div className="discovery-nearby-layout">
          <PartnerMap candidates={candidates} selectedId={selectedId} onSelect={select} />
          <div className="discovery-partners" aria-label="Potential manufacturing partners">
            {candidates.map((candidate, index) => {
              const selected = selectedId === candidate.candidate_id
              const distance = formatDistance(candidate.distance_km)
              return (
                <article key={candidate.candidate_id} className={`discovery-partner${selected ? ' selected' : ''}`}
                  aria-labelledby={`partner-name-${index}`}>
                  <header>
                    <span className="discovery-rank" aria-label={`Partner ${index + 1}`}>{index + 1}</span>
                    <h3 id={`partner-name-${index}`}><button type="button" className="discovery-partner-select"
                      ref={(button) => { if (button) buttons.current.set(candidate.candidate_id, button); else buttons.current.delete(candidate.candidate_id) }}
                      aria-pressed={selected} aria-label={`Select ${candidate.name}`} onClick={() => select(candidate.candidate_id, 'list')}>
                      {candidate.name}
                    </button></h3>
                    {distance && <span className="discovery-distance" aria-label={`Straight-line distance: ${distance}`}>
                      <MapPin aria-hidden="true" />{distance}</span>}
                  </header>
                  <div className="discovery-match-row"><strong>{matchLabel(candidate)}</strong>
                    {selected && <span><Check aria-hidden="true" /> Selected</span>}</div>
                  <p className="discovery-evidence">{evidenceSummary(candidate, specification)}</p>
                  <footer>
                    <span className="discovery-public-label">PUBLIC DATA ONLY</span>
                    <p className="discovery-disclaimer">{candidate.disclaimer}</p>
                    <button type="button" className="discovery-button secondary" onClick={() => onProfile(candidate)}>
                      View partner profile <ArrowRight aria-hidden="true" />
                    </button>
                  </footer>
                </article>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="discovery-empty"><Search aria-hidden="true" />
          <h3>We couldn&apos;t find a relevant manufacturing partner nearby based on the public data currently available.</h3>
          <p>Try another location or review the process and material.</p></div>
      )}
    </section>
  )
}

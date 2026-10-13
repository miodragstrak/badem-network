import { useEffect, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { humanize, processLabel, SCORE_CATEGORIES } from './forms.js'

function SignalList({ label, values }) {
  return (
    <div className="discovery-signal">
      <dt>{label}</dt>
      <dd>{values?.length ? values.map(humanize).join(', ') : 'No public signal recorded'}</dd>
    </div>
  )
}

export default function PartnerProfile({ candidate, api, onClose }) {
  const dialog = useRef(null)
  const opener = useRef(null)
  const [load, setLoad] = useState({ status: 'loading', data: null, error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!opener.current) opener.current = document.activeElement
    const previousFocus = opener.current
    const element = dialog.current
    element.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    api
      .getProfile(candidate.candidate_id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', data, error: '' })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoad({ status: 'error', data: null, error: error.message })
      })
    return () => controller.abort()
  }, [api, candidate.candidate_id, attempt])

  const data = load.data
  const profile = data?.partner_profile || {}
  const signals = profile.signals || {}
  const enrichment = profile.enrichment

  function keepFocusInside(event) {
    if (event.key !== 'Tab') return
    const targets = [...dialog.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
    const first = targets[0]
    const last = targets.at(-1)
    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target?.focus()
    }
  }

  function retry() {
    dialog.current.querySelector('button')?.focus()
    setLoad({ status: 'loading', data: null, error: '' })
    setAttempt((value) => value + 1)
  }

  return (
    <dialog
      ref={dialog}
      className="discovery-profile"
      aria-labelledby="profile-title"
      onCancel={onClose}
      onKeyDown={keepFocusInside}
    >
      <header className="discovery-profile-header">
        <div>
          <p className="discovery-eyebrow">Public Capacity Profile</p>
          <h2 id="profile-title">{candidate.name}</h2>
        </div>
        <button
          type="button"
          className="discovery-icon-button"
          aria-label="Close partner profile"
          title="Close partner profile"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <div
        className="discovery-profile-body"
        tabIndex="0"
        role="region"
        aria-label="Public capacity profile details"
      >
        {load.status === 'loading' && <p role="status">Loading public capacity profile...</p>}
        {load.status === 'error' && (
          <div role="alert" className="discovery-error">
            <p>{load.error}</p>
            <button type="button" className="discovery-button secondary" onClick={retry}>
              Retry profile
            </button>
          </div>
        )}
        {data && (
          <>
            <div className="discovery-profile-fit">
              <strong>
                {data.fit_score}
                <small>/100</small>
              </strong>
              <div>
                <b>{data.fit_label}</b>
                <span>Fit confidence: {humanize(data.confidence)}</span>
              </div>
            </div>
            <p className="discovery-location">
              <MapPin aria-hidden="true" />
              {profile.location_summary || 'Location unavailable'}
            </p>
            <div className="discovery-public-label">
              {humanize(data.verification_status).toUpperCase()}
            </div>
            <p className="discovery-disclaimer">{data.disclaimer}</p>
            <section className="discovery-profile-section">
              <h3>Inferred capabilities</h3>
              <p className="discovery-muted">
                Inferred from public signals, not verified production capability.
              </p>
              {profile.inferred_capabilities?.length ? (
                <ul className="discovery-capabilities">
                  {profile.inferred_capabilities.map((item) => (
                    <li key={item.capability}>
                      <strong>{processLabel(item.capability)}</strong>
                      <ul>
                        {item.evidence?.map((evidence) => (
                          <li key={evidence}>{evidence}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No process capability inferred from the available public signals.</p>
              )}
            </section>
            <section className="discovery-profile-section">
              <h3>Public evidence</h3>
              <p className="discovery-muted">
                Source:{' '}
                {data.is_mock
                  ? 'Mock public data (fictional fixtures)'
                  : 'Google Places public data'}
              </p>
              <dl className="discovery-signals">
                <SignalList label="Materials" values={signals.material_signals} />
                <SignalList label="Equipment signals" values={signals.equipment_signals} />
                <SignalList
                  label="Business specialization"
                  values={signals.specialization_signals}
                />
                <div className="discovery-signal">
                  <dt>Laser-related name</dt>
                  <dd>
                    {signals.laser_related_name
                      ? 'Public name signal present'
                      : 'No public signal recorded'}
                  </dd>
                </div>
                <div className="discovery-signal">
                  <dt>Website listing</dt>
                  <dd>
                    {signals.website_signal
                      ? 'Website signal present; content not checked'
                      : 'No public signal recorded'}
                  </dd>
                </div>
                <div className="discovery-signal">
                  <dt>Public activity</dt>
                  <dd>
                    {signals.public_activity_signal
                      ? 'Public activity signal present'
                      : 'No public signal recorded'}
                  </dd>
                </div>
                <SignalList
                  label="Public keyword signals"
                  values={signals.review_keyword_signals}
                />
              </dl>
            </section>
            <section className="discovery-profile-section">
              <h3>Score breakdown</h3>
              <div className="discovery-breakdown">
                {SCORE_CATEGORIES.map(([key, label, max]) => (
                  <div key={key}>
                    <label htmlFor={`score-${key}`}>{label}</label>
                    <meter
                      id={`score-${key}`}
                      min="0"
                      max={max}
                      value={data.score_breakdown[key] || 0}
                    />
                    <span>
                      {data.score_breakdown[key] || 0} / {max}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            {enrichment && (
              <section className="discovery-profile-section">
                <h3>Public listing enrichment</h3>
                <p>
                  {enrichment.status === 'ENRICHED'
                    ? 'Additional public listing signals recorded'
                    : 'Additional public listing details unavailable'}
                </p>
                {enrichment.signals?.length > 0 && (
                  <ul>
                    {enrichment.signals.map((signal) => (
                      <li key={signal}>{humanize(signal)}</li>
                    ))}
                  </ul>
                )}
                {enrichment.public_evidence && (
                  <dl className="discovery-signals">
                    <div className="discovery-signal">
                      <dt>Website present</dt>
                      <dd>
                        {enrichment.public_evidence.website_present
                          ? 'Yes, content not checked'
                          : 'No'}
                      </dd>
                    </div>
                    <div className="discovery-signal">
                      <dt>Public rating present</dt>
                      <dd>
                        {enrichment.public_evidence.rating_present
                          ? 'Yes, not a quality guarantee'
                          : 'No'}
                      </dd>
                    </div>
                    <div className="discovery-signal">
                      <dt>Listing activity</dt>
                      <dd>
                        {humanize(enrichment.public_evidence.public_activity_signal_strength)}
                      </dd>
                    </div>
                    <div className="discovery-signal">
                      <dt>Business listing status</dt>
                      <dd>{humanize(enrichment.public_evidence.business_operational_signal)}</dd>
                    </div>
                  </dl>
                )}
              </section>
            )}
            <section className="discovery-profile-section">
              <h3>Fit reasoning</h3>
              <ul className="discovery-reasons">
                {data.reasoning.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </dialog>
  )
}

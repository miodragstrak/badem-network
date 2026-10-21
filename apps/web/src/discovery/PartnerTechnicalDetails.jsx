import { humanize, processLabel, SCORE_CATEGORIES } from './forms.js'
import { publicPartnerDetails } from './qualification.js'

function Signal({ label, values }) {
  const items = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : []
  return <div className="discovery-signal"><dt>{label}</dt>
    <dd>{items.length ? items.map(humanize).join(', ') : 'No public signal recorded'}</dd></div>
}

function presence(value) {
  return value === true ? 'Present' : value === false ? 'Not recorded' : 'Not provided'
}

export default function PartnerTechnicalDetails({ data }) {
  const profile = data.partner_profile || {}
  const signals = profile.signals || {}
  const enrichment = profile.enrichment
  const evidence = enrichment?.public_evidence || {}
  const details = publicPartnerDetails(data)

  return (
    <details className="discovery-profile-section discovery-technical">
      <summary>Technical details</summary>
      <div className="discovery-technical-content">
        <p>Public-signal score: {Number.isFinite(data.fit_score) ? `${data.fit_score}/100` : 'Not provided'}. Fit confidence: {humanize(data.confidence ?? 'not_provided')}.</p>
        <div className="discovery-breakdown">
          {SCORE_CATEGORIES.map(([key, label, max]) => (
            <div key={key}>
              <label htmlFor={`score-${key}`}>{label}</label>
              <meter id={`score-${key}`} min="0" max={max} value={data.score_breakdown?.[key] || 0} />
              <span>{data.score_breakdown?.[key] || 0} / {max}</span>
            </div>
          ))}
        </div>
        <section className="discovery-profile-section">
          <h4>Recorded evidence</h4>
          <p className="discovery-muted">Public inferences, not verified production capability.</p>
          {profile.inferred_capabilities?.length > 0 && (
            <ul className="discovery-capabilities">
              {profile.inferred_capabilities.map((item) => (
                <li key={item.capability}><strong>{processLabel(item.capability)}</strong>
                  <ul>{item.evidence?.map((value) => <li key={value}>{value}</li>)}</ul>
                </li>
              ))}
            </ul>
          )}
          <dl className="discovery-signals">
            <Signal label="Materials" values={signals.material_signals} />
            <Signal label="Equipment signals" values={signals.equipment_signals} />
            <Signal label="Business specialization" values={signals.specialization_signals} />
            <Signal label="Public keyword signals" values={signals.review_keyword_signals} />
            <div className="discovery-signal"><dt>Laser-related name</dt><dd>{presence(signals.laser_related_name)}</dd></div>
          </dl>
        </section>
        <section className="discovery-profile-section">
          <h4>Listing metadata</h4>
          <dl className="discovery-signals">
            <div className="discovery-signal"><dt>Enrichment status</dt><dd>{humanize(enrichment?.status ?? 'not_provided')}</dd></div>
            <Signal label="Recorded listing signals" values={enrichment?.signals} />
            <div className="discovery-signal"><dt>Website listing</dt>
              <dd>{presence(evidence.website_present ?? signals.website_signal)}; content not checked</dd></div>
            <div className="discovery-signal"><dt>Rating activity</dt>
              <dd>{presence(evidence.rating_present)}{details.ratingPresent && details.rating === null ? '; numeric rating not provided' : ''}</dd></div>
            <div className="discovery-signal"><dt>Public activity</dt><dd>{presence(signals.public_activity_signal)}</dd></div>
            <div className="discovery-signal"><dt>Listing activity</dt><dd>{humanize(evidence.public_activity_signal_strength ?? 'not_provided')}</dd></div>
            <div className="discovery-signal"><dt>Operational listing signal</dt><dd>{humanize(evidence.business_operational_signal ?? 'not_provided')}</dd></div>
          </dl>
        </section>
        <section className="discovery-profile-section">
          <h4>Fit reasoning</h4>
          <ul className="discovery-reasons">{(data.reasoning || []).map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section>
      </div>
    </details>
  )
}

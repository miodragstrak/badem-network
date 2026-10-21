import { CircleDashed, CircleDot, ExternalLink, MapPin, Minus, Phone } from 'lucide-react'
import { formatDistance, matchLabel } from './presentation.js'
import { publicPartnerDetails, qualificationMatchSummary } from './qualification.js'
import PartnerTechnicalDetails from './PartnerTechnicalDetails.jsx'

const SIGNAL_ICONS = { found: CircleDot, partial: CircleDashed, none: Minus }

export default function PartnerQualification({ data }) {
  const details = publicPartnerDetails(data)
  const summary = qualificationMatchSummary(data)
  const distance = formatDistance(data.distance_km)
  const hasRating = details.rating !== null || details.reviewCount !== null

  return (
    <div className="discovery-qualification">
      <div className="discovery-qualification-summary">
        <b>{matchLabel(data)}</b>
        {distance && <span><MapPin aria-hidden="true" /> {distance} straight-line distance</span>}
      </div>
      <section className="discovery-profile-section discovery-contact-section" aria-labelledby="workshop-details-title">
        <h3 id="workshop-details-title">Workshop details</h3>
        <p className="discovery-muted">{data.is_mock ? 'Fictional mock public data' : 'Google Places public data'}</p>
        <dl className="discovery-signals">
          {(details.address || details.location) && (
            <div className="discovery-signal"><dt>{details.address ? 'Address' : 'Location'}</dt>
              <dd>{details.address || details.location}</dd></div>
          )}
          {details.website && <div className="discovery-signal"><dt>Website</dt><dd>{details.website.label}</dd></div>}
          {details.phone && <div className="discovery-signal"><dt>Public phone</dt><dd>{details.phone.label}</dd></div>}
          {details.businessStatus && <div className="discovery-signal"><dt>Business listing status</dt><dd>{details.businessStatus}</dd></div>}
        </dl>
        {hasRating && (
          <div className="discovery-business-context">
            <dl className="discovery-rating-context">
              {details.rating !== null && <div><dt>Public rating</dt><dd>{details.rating} / 5</dd></div>}
              {details.reviewCount !== null && <div><dt>Public review count</dt><dd>{details.reviewCount.toLocaleString('en-GB')}</dd></div>}
            </dl>
            <p className="discovery-muted">Public business activity, not production capability or product quality.</p>
          </div>
        )}
        {(details.website || details.phone) ? (
          <div className="discovery-contact-actions" aria-label="Workshop contact actions">
            {details.website && (
              <a className="discovery-button primary" href={details.website.href} target="_blank"
                rel="noopener noreferrer" referrerPolicy="no-referrer">
                <ExternalLink aria-hidden="true" />Visit website
              </a>
            )}
            {details.phone && (
              <a className="discovery-button secondary" href={details.phone.href}>
                <Phone aria-hidden="true" />Call workshop
              </a>
            )}
          </div>
        ) : (
          <p className="discovery-contact-note">No public contact links are available for this listing.</p>
        )}
        {details.websitePresent && !details.website && (
          <p className="discovery-contact-note">A website is listed, but its URL is not available.</p>
        )}
      </section>
      <section className="discovery-profile-section discovery-qualification-evidence" aria-labelledby="qualification-evidence-title">
        <h3 id="qualification-evidence-title">Why this may be a match</h3>
        <h4 className="discovery-match-heading" id="match-summary-title">Match Summary</h4>
        <p className="discovery-muted">Public signals for this request, not verified capability.</p>
        <dl className="discovery-match-summary" aria-labelledby="match-summary-title">
          {summary.map((row) => {
            const Icon = SIGNAL_ICONS[row.state]
            return (
              <div key={row.label} className="discovery-match-summary-row" data-state={row.state}>
                <dt>{row.label}</dt>
                <dd><span className="discovery-match-summary-status"><Icon aria-hidden="true" />{row.status}</span>
                  {row.signals.length > 0 && <span className="discovery-match-summary-signals">{row.signals.join(', ')}</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
      <PartnerTechnicalDetails data={data} />
    </div>
  )
}

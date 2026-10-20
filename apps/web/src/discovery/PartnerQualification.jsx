import { Activity, ExternalLink, MapPin, Phone } from 'lucide-react'
import { formatDistance, matchLabel } from './presentation.js'
import { publicPartnerDetails, qualificationEvidence } from './qualification.js'

export default function PartnerQualification({ data }) {
  const details = publicPartnerDetails(data)
  const evidence = qualificationEvidence(data)
  const distance = formatDistance(data.distance_km)
  const hasActivity = details.rating !== null || details.reviewCount !== null || details.ratingPresent || details.activity

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
        <p className="discovery-muted">Reported public signals, not confirmed production capability or equipment availability.</p>
        {evidence.length ? (
          <dl className="discovery-signals">
            {evidence.map((row) => (
              <div key={row.label} className="discovery-signal"><dt>{row.label}</dt><dd>
                <ul className="discovery-qualification-signals">
                  {row.items.map((item) => (
                    <li key={item.label}><span>{item.label}</span>
                      {item.evidence.length > 0 && <ul>{item.evidence.map((value) => <li key={value}>{value}</li>)}</ul>}
                    </li>
                  ))}
                </ul>
              </dd></div>
            ))}
          </dl>
        ) : <p>No supported manufacturing-match evidence is recorded in this profile.</p>}
      </section>
      {hasActivity && (
        <section className="discovery-profile-section discovery-public-activity" aria-labelledby="public-activity-title">
          <h3 id="public-activity-title"><Activity aria-hidden="true" /> Public business activity</h3>
          <p className="discovery-muted">Ratings and review counts are public business context, not evidence of manufacturing capability or product quality.</p>
          <dl className="discovery-signals">
            {details.rating !== null && <div className="discovery-signal"><dt>Public rating</dt><dd>{details.rating} / 5</dd></div>}
            {details.reviewCount !== null && <div className="discovery-signal"><dt>Public review count</dt><dd>{details.reviewCount.toLocaleString('en-GB')}</dd></div>}
            {details.ratingPresent && details.rating === null && (
              <div className="discovery-signal"><dt>Rating activity</dt><dd>Recorded; numeric rating not provided</dd></div>
            )}
            {details.activity && <div className="discovery-signal"><dt>Listing activity</dt><dd>{details.activity}</dd></div>}
          </dl>
        </section>
      )}
    </div>
  )
}

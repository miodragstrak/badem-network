import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Factory,
  FileText,
  Loader2,
  MapPin,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { createDiscoveryApi } from './api.js'
import {
  humanize,
  INITIAL_REQUEST,
  MATERIALS,
  prefillSpecification,
  processLabel,
  PROCESSES,
  requestPayload,
  specificationPayload,
  validateRequest,
  validateSpecification,
} from './forms.js'
import PartnerProfile from './PartnerProfile.jsx'
import AppNavigation from '../AppNavigation.jsx'
import '../App.css'
import './discovery.css'

const STEPS = [
  ['Request', FileText],
  ['Specification', SlidersHorizontal],
  ['Partners', Search],
]
const HEADINGS = [
  'Describe what you need made',
  'Review manufacturing specification',
  'Potential production partners',
]
const SUBHEADINGS = [
  'Tell BADEM what you want to produce. We\u2019ll turn it into a manufacturing specification and discover potential production partners.',
  'Review the process, material and production requirements.',
  'Ranked using publicly available business signals and your manufacturing specification.',
]

function Field({ name, label, error, children, ...props }) {
  return (
    <div className="discovery-field">
      <label htmlFor={`discovery-${name}`}>{label}</label>
      {children || (
        <input
          id={`discovery-${name}`}
          name={name}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `error-${name}` : undefined}
          {...props}
        />
      )}
      {error && (
        <p id={`error-${name}`} className="discovery-field-error">
          {error}
        </p>
      )}
    </div>
  )
}

function Progress({ step }) {
  return (
    <nav aria-label="Manufacturing discovery progress">
      <ol className="discovery-progress">
        {STEPS.map(([label, Icon], index) => (
          <li
            key={label}
            className={index + 1 === step ? 'current' : index + 1 < step ? 'complete' : ''}
            aria-current={index + 1 === step ? 'step' : undefined}
          >
            <span className="discovery-step-number">
              {index + 1 < step ? <Check aria-hidden="true" /> : index + 1}
            </span>
            <span>
              <Icon aria-hidden="true" />
              {label}
            </span>
            {index < 2 && <ChevronRight className="discovery-step-arrow" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function RequestForm({ values, setValues, errors, busy, onSubmit }) {
  const update = (event) => setValues({ ...values, [event.target.name]: event.target.value })
  return (
    <form noValidate onSubmit={onSubmit} className="discovery-form">
      <fieldset disabled={busy}>
        <Field
          name="title"
          label="Title"
          value={values.title}
          onChange={update}
          maxLength={120}
          required
          error={errors.title}
        />
        <Field name="description" label="Description" error={errors.description}>
          <textarea
            id="discovery-description"
            name="description"
            rows="4"
            value={values.description}
            onChange={update}
            maxLength={8000}
            required
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'error-description' : undefined}
          />
        </Field>
        <div className="discovery-field-row">
          <Field
            name="location"
            label="Location"
            value={values.location}
            onChange={update}
            placeholder="Belgrade, Serbia"
            maxLength={240}
            required
            error={errors.location}
          />
          <Field
            name="quantity"
            label="Quantity"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={values.quantity}
            onChange={update}
            required
            error={errors.quantity}
          />
        </div>
      </fieldset>
      <div className="discovery-form-actions">
        <button className="discovery-button primary" type="submit" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" aria-hidden="true" />
          ) : (
            <ArrowRight aria-hidden="true" />
          )}
          {busy ? 'Creating manufacturing request...' : 'Create manufacturing request'}
        </button>
      </div>
    </form>
  )
}

function SpecificationForm({ values, setValues, errors, busy, onSubmit }) {
  const update = (event) => setValues({ ...values, [event.target.name]: event.target.value })
  return (
    <form noValidate onSubmit={onSubmit} className="discovery-form">
      <fieldset disabled={busy}>
        <div className="discovery-field-row">
          <Field name="process" label="Process" error={errors.process}>
            <select
              id="discovery-process"
              name="process"
              value={values.process}
              onChange={update}
              aria-invalid={Boolean(errors.process)}
              aria-describedby={errors.process ? 'error-process' : undefined}
            >
              {PROCESSES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field name="material" label="Material" error={errors.material}>
            <select
              id="discovery-material"
              name="material"
              value={values.material}
              onChange={update}
              aria-invalid={Boolean(errors.material)}
              aria-describedby={errors.material ? 'error-material' : undefined}
            >
              {MATERIALS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {values.material === 'other' && (
          <Field
            name="customMaterial"
            label="Custom material"
            value={values.customMaterial}
            onChange={update}
            maxLength={120}
            required
            error={errors.customMaterial}
          />
        )}
        <Field
          name="quantity"
          label="Quantity"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={values.quantity}
          onChange={update}
          required
          error={errors.quantity}
        />
        <fieldset className="discovery-dimensions">
          <legend>
            Dimensions <span>mm, optional</span>
          </legend>
          <div className="discovery-field-row three">
            {['width', 'height', 'thickness'].map((name) => (
              <Field
                key={name}
                name={name}
                label={humanize(name)}
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="mm"
                value={values[name]}
                onChange={update}
                error={errors[name]}
              />
            ))}
          </div>
        </fieldset>
        <Field name="requirements" label="Requirements" error={errors.requirements}>
          <textarea
            id="discovery-requirements"
            name="requirements"
            rows="3"
            value={values.requirements}
            onChange={update}
            placeholder="Engraved logo"
            aria-invalid={Boolean(errors.requirements)}
            aria-describedby={errors.requirements ? 'error-requirements' : undefined}
          />
        </Field>
        <div className="discovery-field-row">
          <Field
            name="city"
            label="City"
            value={values.city}
            onChange={update}
            maxLength={120}
            error={errors.city}
          />
          <Field
            name="country"
            label="Country"
            value={values.country}
            onChange={update}
            placeholder="RS"
            maxLength={120}
            error={errors.country}
          />
        </div>
      </fieldset>
      <div className="discovery-form-actions">
        <button className="discovery-button primary" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          {busy ? 'Discovering potential partners...' : 'Find potential partners'}
        </button>
      </div>
    </form>
  )
}

function RequestSummary({ request, specification, step }) {
  return (
    <aside className="discovery-summary" aria-label="Manufacturing request summary">
      {step === 1 ? (
        <>
          <figure>
            <img
              src="/demo-assets/badem-wooden-tags.png"
              alt="BADEM prototype mark engraved on plywood"
              width="1024"
              height="1024"
            />
            <figcaption>BADEM prototype engraving</figcaption>
          </figure>
          <p className="discovery-eyebrow">Manufacturing request</p>
          <h2>{request.title || 'Your production request'}</h2>
          <p className="discovery-muted">
            {request.quantity || '\u2014'} pieces
            {request.location ? ` \u00b7 ${request.location}` : ''}
          </p>
        </>
      ) : (
        <>
          <p className="discovery-eyebrow">Manufacturing request</p>
          <h2>{request.title}</h2>
          <p className="discovery-summary-description">{request.description}</p>
          <dl>
            <div>
              <dt>Process</dt>
              <dd>{processLabel(specification.process)}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>
                {specification.material === 'other'
                  ? specification.customMaterial
                  : humanize(specification.material)}
              </dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>{specification.quantity} pieces</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                {[specification.city, specification.country].filter(Boolean).join(', ') ||
                  'Not specified'}
              </dd>
            </div>
          </dl>
        </>
      )}
    </aside>
  )
}

function PartnerCard({ candidate, rank, onProfile }) {
  return (
    <article className="discovery-partner">
      <header>
        <div className="discovery-partner-name">
          <span className="discovery-rank">#{rank}</span>
          <h2>{candidate.name}</h2>
        </div>
        <div className="discovery-fit">
          <strong>
            {candidate.fit_score}
            <small>/100</small>
          </strong>
          <span>{candidate.fit_label}</span>
        </div>
      </header>
      <div className="discovery-partner-meta">
        <span>
          Fit confidence: <b>{humanize(candidate.confidence)}</b>
        </span>
        <span>
          {candidate.is_mock ? 'Mock public data (fictional)' : 'Google Places public data'}
        </span>
      </div>
      <h3>Why this match</h3>
      <ul className="discovery-reasons">
        {candidate.reasoning.slice(0, 4).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <footer>
        <div>
          <span className="discovery-public-label">
            {humanize(candidate.verification_status).toUpperCase()}
          </span>
          <p className="discovery-disclaimer">{candidate.disclaimer}</p>
        </div>
        <button
          type="button"
          className="discovery-button secondary"
          onClick={() => onProfile(candidate)}
        >
          View partner profile
          <ArrowRight aria-hidden="true" />
        </button>
      </footer>
    </article>
  )
}

export default function DiscoveryWizard({ getAccessToken, onAccessError, account }) {
  const [api] = useState(() => createDiscoveryApi({ getAccessToken, onAccessError }))
  const [step, setStep] = useState(1)
  const [request, setRequest] = useState(INITIAL_REQUEST)
  const [requestId, setRequestId] = useState('')
  const [specification, setSpecification] = useState(() => prefillSpecification(INITIAL_REQUEST))
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const [profile, setProfile] = useState(null)
  const operation = useRef(null)
  const heading = useRef(null)
  const previousStep = useRef(step)

  useEffect(() => {
    document.title = 'Production Partner Discovery | BADEM'
    return () => operation.current?.abort()
  }, [])

  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus()
    previousStep.current = step
  }, [step])

  function showValidation(fieldErrors) {
    setErrors(fieldErrors)
    setError('Please review the highlighted fields.')
    document.getElementById(`discovery-${Object.keys(fieldErrors)[0]}`)?.focus()
  }

  async function createRequest(event) {
    event.preventDefault()
    if (operation.current) return
    const fieldErrors = validateRequest(request)
    if (Object.keys(fieldErrors).length) {
      showValidation(fieldErrors)
      return
    }
    const controller = new AbortController()
    operation.current = controller
    setErrors({})
    setError('')
    setBusy('Creating manufacturing request...')
    try {
      const created = await api.createRequest(requestPayload(request), controller.signal)
      if (controller.signal.aborted) return
      setRequestId(created.id)
      setSpecification(prefillSpecification(request))
      setStep(2)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message)
    } finally {
      if (!controller.signal.aborted) {
        setBusy('')
        operation.current = null
      }
    }
  }

  async function discover(event) {
    event.preventDefault()
    if (operation.current) return
    const fieldErrors = validateSpecification(specification)
    if (Object.keys(fieldErrors).length) {
      showValidation(fieldErrors)
      return
    }
    const controller = new AbortController()
    operation.current = controller
    setErrors({})
    setError('')
    setBusy('Saving manufacturing specification...')
    try {
      await api.saveSpecification(requestId, specificationPayload(specification), controller.signal)
      if (controller.signal.aborted) return
      setBusy(
        'Discovering potential production partners... Analyzing public manufacturing signals...',
      )
      const discovered = await api.discover(requestId, controller.signal)
      if (controller.signal.aborted) return
      if (!Array.isArray(discovered.candidates))
        throw new Error('Partner discovery could not be loaded. Please try again.')
      setResult(discovered)
      setStep(3)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message)
    } finally {
      if (!controller.signal.aborted) {
        setBusy('')
        operation.current = null
      }
    }
  }

  function startNewRequest() {
    if (operation.current) return
    setRequest(INITIAL_REQUEST)
    setSpecification(prefillSpecification(INITIAL_REQUEST))
    setRequestId('')
    setResult(null)
    setErrors({})
    setError('')
    setStep(1)
  }

  return (
    <main id="app-main" className="discovery-shell" tabIndex="-1">
      <header className="discovery-topbar">
        <a className="brand" href="/" aria-label="BADEM home">
          <img
            src="/brand/badem-three-layer-lockup.png"
            alt="aiBADEM - Identity, Network, Manufacturing"
            width="1600"
            height="720"
          />
          <span>
            <em>AI-Based DePIN Manufacturing</em>
          </span>
        </a>
        <div className="discovery-topbar-actions">
          <AppNavigation current="discovery" />
          {account}
        </div>
      </header>
      <div className="discovery-container">
        <Progress step={step} />
        <header className="discovery-heading">
          <p className="discovery-eyebrow">
            <Factory aria-hidden="true" />
            Production Partner Discovery
          </p>
          <h1 ref={heading} tabIndex="-1">
            {HEADINGS[step - 1]}
          </h1>
          <p>{SUBHEADINGS[step - 1]}</p>
        </header>
        {error && (
          <div className="discovery-error" role="alert">
            {error}
          </div>
        )}
        <div className="discovery-announcement" role="status" aria-live="polite">
          {busy && (
            <>
              <Loader2 className="spin" aria-hidden="true" />
              <span>{busy}</span>
            </>
          )}
        </div>
        {step < 3 ? (
          <div className="discovery-workspace" aria-busy={Boolean(busy)}>
            {step === 1 ? (
              <RequestForm
                values={request}
                setValues={setRequest}
                errors={errors}
                busy={Boolean(busy)}
                onSubmit={createRequest}
              />
            ) : (
              <SpecificationForm
                values={specification}
                setValues={setSpecification}
                errors={errors}
                busy={Boolean(busy)}
                onSubmit={discover}
              />
            )}
            <RequestSummary request={request} specification={specification} step={step} />
          </div>
        ) : (
          <>
            <div className="discovery-results-summary">
              <div>
                <b>{request.title}</b>
                <span>
                  {processLabel(specification.process)}
                  {' \u00b7 '}
                  {specification.material === 'other'
                    ? specification.customMaterial
                    : humanize(specification.material)}
                  {' \u00b7 '}
                  {specification.quantity} pieces
                </span>
                <span>
                  <MapPin aria-hidden="true" />
                  {[specification.city, specification.country].filter(Boolean).join(', ') ||
                    'Location not specified'}
                </span>
              </div>
              <button
                type="button"
                className="discovery-button secondary"
                onClick={() => {
                  setErrors({})
                  setError('')
                  setStep(2)
                }}
              >
                <SlidersHorizontal aria-hidden="true" />
                Edit specification
              </button>
            </div>
            <div className="discovery-results-count">
              <span>
                {result.candidates.length} potential{' '}
                {result.candidates.length === 1 ? 'partner' : 'partners'}
              </span>
              <span>
                {result.provider === 'MOCK_PUBLIC_DATA'
                  ? 'Mock provider \u00b7 fictional public-data fixtures'
                  : 'Google Places \u00b7 public-data signals'}
              </span>
            </div>
            {result.candidates.length ? (
              <div className="discovery-partners">
                {result.candidates.map((candidate, index) => (
                  <PartnerCard
                    key={candidate.candidate_id}
                    candidate={candidate}
                    rank={index + 1}
                    onProfile={setProfile}
                  />
                ))}
              </div>
            ) : (
              <div className="discovery-empty">
                <Search aria-hidden="true" />
                <h2>No strong potential production partners were found for this specification.</h2>
                <p>Try adjusting the process, material, or location.</p>
              </div>
            )}
          </>
        )}
        {step > 1 && (
          <div className="discovery-bottom-actions">
            <button
              type="button"
              className="discovery-text-button"
              onClick={startNewRequest}
              disabled={Boolean(busy)}
            >
              <ArrowLeft aria-hidden="true" />
              Start a new request
            </button>
          </div>
        )}
      </div>
      {profile && (
        <PartnerProfile
          key={profile.candidate_id}
          candidate={profile}
          api={api}
          onClose={() => setProfile(null)}
        />
      )}
    </main>
  )
}

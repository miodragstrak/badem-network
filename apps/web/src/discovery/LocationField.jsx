import { useEffect, useRef, useState } from 'react'
import { Check, LocateFixed, Loader2 } from 'lucide-react'
import { editLocation, getDeviceLocation, usableCoordinates } from './location.js'

export default function LocationField({ values, setValues, error, disabled, onBusyChange }) {
  const [status, setStatus] = useState('')
  const [locating, setLocating] = useState(false)
  const pending = useRef(null)
  useEffect(() => () => {
    pending.current?.abort()
    onBusyChange(false)
  }, [onBusyChange])

  function edit(event) {
    pending.current?.abort()
    pending.current = null
    setLocating(false)
    onBusyChange(false)
    setStatus('')
    const value = event.target.value
    setValues((current) => editLocation(current, value))
  }

  async function locate() {
    if (pending.current || disabled) return
    const controller = new AbortController()
    pending.current = controller
    setLocating(true)
    onBusyChange(true)
    setStatus('Finding your location...')
    try {
      const point = await getDeviceLocation(navigator.geolocation, controller.signal)
      if (controller.signal.aborted) return
      setValues((current) => ({ ...current, location: 'Current location', city: '', country: '', ...point }))
      setStatus('Using your current location.')
    } catch (failure) {
      if (!controller.signal.aborted) setStatus(failure.message)
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null
        setLocating(false)
        onBusyChange(false)
      }
    }
  }

  return (
    <div className="discovery-location-field">
      <label htmlFor="discovery-location">Location</label>
      <div className="discovery-location-controls">
        <input id="discovery-location" name="location" value={values.location || ''}
          placeholder="Bor, Serbia" maxLength={240} onChange={edit} disabled={disabled}
          autoComplete="off" aria-invalid={Boolean(error)}
          aria-describedby={error ? 'error-location location-status' : 'location-status'} />
        <button type="button" className="discovery-button secondary" onClick={locate}
          disabled={disabled || locating}>
          {locating ? <Loader2 className="spin" aria-hidden="true" /> : <LocateFixed aria-hidden="true" />}
          Use my location
        </button>
      </div>
      <p id="location-status" className="discovery-location-status" role="status" aria-live="polite">
        {usableCoordinates(values) && !locating && <Check aria-hidden="true" />}
        {status || (usableCoordinates(values)
          ? values.location === 'Current location' ? 'Using your current location.' : 'Using your entered location.'
          : 'City and country, or your current location.')}
      </p>
      {error && <p id="error-location" className="discovery-field-error">{error}</p>}
    </div>
  )
}

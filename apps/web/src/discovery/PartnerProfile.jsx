import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import PartnerQualification from './PartnerQualification.jsx'
import { PUBLIC_DATA_DISCLAIMER, PUBLIC_DATA_STATUS } from './qualification.js'

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

  function keepFocusInside(event) {
    if (event.key !== 'Tab') return
    const targets = [...dialog.current.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex="0"]')]
      .filter((element) => element.getClientRects().length > 0)
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
          <p className="discovery-eyebrow">Partner qualification</p>
          <h2 id="profile-title">{data?.name || candidate.name}</h2>
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
      <div className="discovery-profile-verification">
        <span className="discovery-public-label">{PUBLIC_DATA_STATUS}</span>
        <p className="discovery-disclaimer">{PUBLIC_DATA_DISCLAIMER}</p>
      </div>
      <div
        className="discovery-profile-body"
        tabIndex="0"
        role="region"
        aria-label="Partner qualification details"
      >
        {load.status === 'loading' && <p role="status">Loading partner qualification...</p>}
        {load.status === 'error' && (
          <div role="alert" className="discovery-error">
            <p>{load.error}</p>
            <button type="button" className="discovery-button secondary" onClick={retry}>
              Retry profile
            </button>
          </div>
        )}
        {data && <PartnerQualification data={data} />}
      </div>
    </dialog>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2, LogIn, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import AppNavigation from '../AppNavigation.jsx'
import DiscoveryWizard from '../discovery/DiscoveryWizard.jsx'
import AccountIndicator from './AccountIndicator.jsx'
import { getBrowserAuthClient } from './client.js'
import { BETA_INVITE_MESSAGE, BETA_SESSION_MESSAGE, BETA_SESSION_PATH } from './messages.js'
import './private-beta.css'

function SignIn({ client, state, busy, onSignOut, onRetry }) {
  const [emailOpen, setEmailOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [action, setAction] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function signIn(kind, event) {
    event?.preventDefault()
    if (!client || inFlight.current) return
    inFlight.current = true
    setAction(kind)
    setNotice('')
    try {
      const redirect = new URL('/discovery', window.location.origin).href
      const result =
        kind === 'google'
          ? await client.auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo: redirect },
            })
          : await client.auth.signInWithOtp({
              email: email.trim(),
              options: { emailRedirectTo: redirect, shouldCreateUser: false },
            })
      if (result.error) throw new Error('Sign-in failed')
      if (kind === 'email' && mounted.current) setNotice('Check your email for a sign-in link.')
    } catch {
      if (mounted.current) setNotice('Sign-in is temporarily unavailable. Please try again later.')
    } finally {
      inFlight.current = false
      if (mounted.current) setAction('')
    }
  }
  const checking = state.status === 'checking'
  const blocked = state.status === 'forbidden'
  return (
    <main id="app-main" className="beta-shell" tabIndex="-1">
      <header className="beta-topbar">
        <a className="brand" href="/" aria-label="BADEM home">
          <img
            src="/brand/badem-three-layer-lockup.png"
            alt="aiBADEM - Identity, Network, Manufacturing"
            width="1600"
            height="720"
          />
        </a>
        <div className="beta-topbar-actions">
          <AppNavigation current="discovery" />
          {state.user && (
            <AccountIndicator email={state.user.email} busy={busy} onSignOut={onSignOut} />
          )}
        </div>
      </header>
      <section className="beta-sign-in" aria-labelledby="beta-title" aria-busy={checking}>
        <p className="beta-eyebrow">
          <ShieldCheck aria-hidden="true" />
          Production Partner Discovery
        </p>
        <h1 id="beta-title">BADEM Private Beta</h1>
        <p className="beta-lead">Sign in to use Production Partner Discovery.</p>
        <p className="beta-description">
          Discover potential manufacturing partners based on public production signals.
        </p>
        {checking ? (
          <p className="beta-notice" role="status">
            <Loader2 className="spin" aria-hidden="true" />
            Checking your access...
          </p>
        ) : blocked ? (
          <p className="beta-notice" role="status">
            {BETA_INVITE_MESSAGE}
          </p>
        ) : state.status === 'error' ? (
          <div className="beta-notice" role="alert">
            <p>{state.message}</p>
            <button type="button" className="beta-button secondary" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : (
          <div className="beta-sign-in-actions">
            {state.message && <p role="status">{state.message}</p>}
            <button
              type="button"
              className="beta-button"
              onClick={() => signIn('google')}
              disabled={!client || Boolean(action)}
            >
              {action === 'google' ? (
                <Loader2 className="spin" aria-hidden="true" />
              ) : (
                <LogIn aria-hidden="true" />
              )}
              Continue with Google
            </button>
            <button
              type="button"
              className="beta-button secondary"
              onClick={() => setEmailOpen(!emailOpen)}
              aria-expanded={emailOpen}
              aria-controls="beta-email"
              disabled={!client || Boolean(action)}
            >
              <Mail aria-hidden="true" />
              Continue with email
            </button>
            {emailOpen && (
              <form id="beta-email" onSubmit={(event) => signIn('email', event)}>
                <label htmlFor="beta-email-address">Email address</label>
                <input
                  id="beta-email-address"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength="254"
                  required
                  disabled={Boolean(action)}
                />
                <button className="beta-button" type="submit" disabled={Boolean(action)}>
                  {action === 'email' ? (
                    <Loader2 className="spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight aria-hidden="true" />
                  )}
                  Send sign-in link
                </button>
              </form>
            )}
            <p className="beta-notice" role="status" aria-live="polite">
              {notice ||
                (!client ? 'Sign-in is temporarily unavailable. Please try again later.' : '')}
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

export default function PrivateBeta() {
  const [client] = useState(getBrowserAuthClient)
  const [state, setState] = useState({ status: 'checking', user: null })
  const [signingOut, setSigningOut] = useState(false)
  const request = useRef(null)
  const version = useRef(0)
  const approvedUser = useRef(null)
  const signOutLock = useRef(false)
  const invalidate = useCallback(() => {
    ++version.current
    request.current?.abort()
  }, [])

  const checkSession = useCallback(async (session) => {
    request.current?.abort()
    const current = ++version.current
    if (!session?.access_token) {
      approvedUser.current = null
      setState({ status: 'signed-out', user: null })
      return
    }
    const controller = new AbortController()
    request.current = controller
    // Preserve an already-authorized draft across refreshes; the server rechecks every API call.
    if (approvedUser.current !== session.user?.id) setState({ status: 'checking', user: null })
    try {
      const response = await fetch(BETA_SESSION_PATH, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
      if (!response.ok) {
        if (current !== version.current || controller.signal.aborted) return
        approvedUser.current = null
        if (
          response.status === 403 &&
          response.headers.get('X-BADEM-Error') === 'BETA_INVITE_REQUIRED'
        ) {
          setState({
            status: 'forbidden',
            user: { email: typeof session.user?.email === 'string' ? session.user.email : '' },
          })
        } else if (response.status === 401)
          setState({ status: 'signed-out', user: null, message: BETA_SESSION_MESSAGE })
        else
          setState({
            status: 'error',
            user: null,
            message: 'Sign-in is temporarily unavailable. Please try again later.',
          })
        return
      }
      const payload = await response.json()
      if (!payload.user?.id || typeof payload.user.email !== 'string')
        throw new Error('Invalid session response')
      if (current === version.current && !controller.signal.aborted) {
        approvedUser.current = payload.user.id
        setState({ status: 'authorized', user: payload.user })
      }
    } catch {
      if (current === version.current && !controller.signal.aborted) {
        approvedUser.current = null
        setState({
          status: 'error',
          user: null,
          message: 'Sign-in is temporarily unavailable. Please try again later.',
        })
      }
    }
  }, [])

  const retry = useCallback(async () => {
    if (!client) return checkSession(null)
    const current = version.current
    const { data, error } = await client.auth.getSession()
    if (current !== version.current) return
    if (error) {
      approvedUser.current = null
      setState({
        status: 'error',
        user: null,
        message: 'Sign-in is temporarily unavailable. Please try again later.',
      })
      return
    }
    return checkSession(data.session)
  }, [client, checkSession])

  useEffect(() => {
    document.title = 'Private Beta Discovery | BADEM'
    let active = true
    if (!client) {
      queueMicrotask(() => {
        if (active) checkSession(null)
      })
    } else {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // Avoid waiting on the SDK's session lock inside its auth-state callback.
        queueMicrotask(() => {
          if (active && !signOutLock.current) checkSession(session)
        })
      })
      queueMicrotask(() => {
        if (active) retry()
      })
      return () => {
        active = false
        invalidate()
        data.subscription.unsubscribe()
      }
    }
    return () => {
      active = false
      invalidate()
    }
  }, [client, retry, checkSession, invalidate])

  const getAccessToken = useCallback(async () => {
    const { data, error } = await client.auth.getSession()
    return error ? '' : data.session?.access_token || ''
  }, [client])

  async function signOut() {
    if (!client || signOutLock.current) return
    signOutLock.current = true
    setSigningOut(true)
    const user = state.user
    ++version.current
    request.current?.abort()
    approvedUser.current = null
    setState({ status: 'checking', user })
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
      setState({ status: 'signed-out', user: null })
    } catch {
      setState({ status: 'error', user, message: 'We could not sign you out. Please try again.' })
    } finally {
      signOutLock.current = false
      setSigningOut(false)
    }
  }

  function accessError(status) {
    ++version.current
    request.current?.abort()
    approvedUser.current = null
    setState(
      status === 403
        ? { status: 'forbidden', user: state.user }
        : { status: 'signed-out', user: null, message: BETA_SESSION_MESSAGE },
    )
  }

  return state.status === 'authorized' ? (
    <DiscoveryWizard
      getAccessToken={getAccessToken}
      onAccessError={accessError}
      account={<AccountIndicator email={state.user.email} busy={signingOut} onSignOut={signOut} />}
    />
  ) : (
    <SignIn client={client} state={state} busy={signingOut} onSignOut={signOut} onRetry={retry} />
  )
}

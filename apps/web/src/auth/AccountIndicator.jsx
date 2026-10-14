import { LogOut, UserRound } from 'lucide-react'

export default function AccountIndicator({ email, busy, onSignOut }) {
  return (
    <div className="beta-account">
      <span>
        <UserRound aria-hidden="true" />
        <span>{email || 'Signed in'}</span>
      </span>
      <button type="button" onClick={onSignOut} disabled={busy}>
        <LogOut aria-hidden="true" />
        {busy ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  )
}

import { ArrowLeft } from 'lucide-react'
import { APP_PATHS } from './routes.js'
import './AppNavigation.css'

export default function AppNavigation({ current }) {
  return (
    <nav className="app-navigation" aria-label="BADEM app navigation">
      <a href={APP_PATHS.home} aria-current={current === 'home' ? 'page' : undefined}>
        {current !== 'home' && <ArrowLeft aria-hidden="true" />}
        {current === 'home' ? 'Home' : 'Back to BADEM'}
      </a>
      <a href={APP_PATHS.discovery} aria-current={current === 'discovery' ? 'page' : undefined}>
        Discovery
      </a>
      <a href={APP_PATHS.proof} aria-current={current === 'proof' ? 'page' : undefined}>
        Proof demo
      </a>
    </nav>
  )
}

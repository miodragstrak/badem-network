import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DiscoveryWizard from './discovery/DiscoveryWizard.jsx'
import AppHome from './AppHome.jsx'
import { resolveAppRoute } from './routes.js'

const route = resolveAppRoute(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <a className="app-skip" href="#app-main">
      Skip to content
    </a>
    {route === 'discovery' ? (
      <DiscoveryWizard />
    ) : route === 'proof' ? (
      <App />
    ) : (
      <AppHome notFound={route === 'not-found'} />
    )}
  </StrictMode>,
)

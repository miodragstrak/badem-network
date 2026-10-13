import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DiscoveryWizard from './discovery/DiscoveryWizard.jsx'

const isDiscovery = /^\/discovery\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isDiscovery ? <DiscoveryWizard /> : <App />}
  </StrictMode>,
)

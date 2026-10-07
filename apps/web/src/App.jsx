import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  Box,
  CheckCircle2,
  CircleDollarSign,
  Cpu,
  Gauge,
  HelpCircle,
  Image,
  Inbox,
  Mail,
  Play,
  Radio,
  RotateCcw,
  Ruler,
  Send,
  Sparkles,
  SmartphoneNfc,
  Terminal,
  Timer,
  UploadCloud,
  Wallet,
  XCircle,
} from 'lucide-react'
import materializeLogo from './assets/materialize-logo.jpg'
import './App.css'

const products = [
  {
    name: 'M-ADAPT-01',
    type: 'Adaptive Pipe Interface',
    compatibility: ['CNC', '3D printer'],
    time: '2h 40m',
    material: 'Carbon-filled PA12',
    generationLabels: ['Generated from local geometry scan', 'Production-ready', 'Node compatible'],
    cost: '0.12 SOL',
    stablePrice: '5 USDC',
    networkFee: '0.00042 SOL fee',
    machineReward: '0.108 SOL',
    platformFee: '0.012 SOL',
    txHash: '5xQ9vB2hMZp7n4Tq3sK8rY1cL6uE9aP2mN7dF4jR8sV',
    nearest: 'CNC Axis-7',
    accent: 'from-amber-300 to-pink-500',
    shape: 'connector',
    variant: 'adaptive',
  },
  {
    name: 'ForgeLink C-9',
    type: 'High-Pressure Coupling',
    compatibility: ['Laser', 'CNC'],
    time: '1h 55m',
    material: 'Reinforced aluminum matrix',
    generationLabels: ['Generated pressure-fit variant', 'Production-ready', 'Infrastructure-grade'],
    cost: '0.09 SOL',
    stablePrice: '4 USDC',
    networkFee: '0.00039 SOL fee',
    machineReward: '0.081 SOL',
    platformFee: '0.009 SOL',
    txHash: '3nG8rK6pVc2Bq9zT5mW1sY7xHa4LwN8dE2fJ6uP9cR',
    nearest: 'LaserForm 2X',
    accent: 'from-pink-300 to-violet-500',
    shape: 'connector',
    variant: 'forge',
  },
  {
    name: 'NanoSeal V2',
    type: 'Rapid Repair Connector',
    compatibility: ['3D printer'],
    time: '3h 10m',
    material: 'Seal-grade polymer composite',
    generationLabels: ['Rapid local fabrication', 'Node compatible', 'Field repair ready'],
    cost: '0.07 SOL',
    stablePrice: '3 USDC',
    networkFee: '0.00031 SOL fee',
    machineReward: '0.063 SOL',
    platformFee: '0.007 SOL',
    txHash: '8uP2cR7xKa5Mqw1F9yL6hV3nTs4BzG8dN5jE2pQ6mX',
    nearest: 'PrintCell M4',
    accent: 'from-orange-300 to-amber-400',
    shape: 'connector',
    variant: 'nano',
  },
]

const machines = [
  {
    id: 'MTL-CNC-AX7',
    label: 'CNC',
    name: 'CNC Axis-7',
    status: 'online',
    availability: 'available',
    compatible: true,
    incompatibilityReason: '',
    load: '91%',
    position: { left: '18%', top: '28%' },
    discoveryPosition: { left: '74%', top: '27%' },
    nearest: '1.8 km',
    materialCompatibility: 'Carbon-filled PA12, aluminum',
    productionTime: '2h 40m',
  },
  {
    id: 'MTL-LSR-2X',
    label: 'Laser',
    name: 'LaserForm 2X',
    status: 'busy',
    availability: 'unsupported',
    compatible: false,
    incompatibilityReason: 'Unsupported material',
    load: '84%',
    position: { left: '68%', top: '22%' },
    discoveryPosition: { left: '80%', top: '72%' },
    nearest: '4.1 km',
    materialCompatibility: 'Sheet alloy only',
    productionTime: 'Geometry incompatibility',
  },
  {
    id: 'MTL-AM-M4',
    label: '3D printer',
    name: 'PrintCell M4',
    status: 'online',
    availability: 'available',
    compatible: true,
    incompatibilityReason: '',
    load: '76%',
    position: { left: '48%', top: '67%' },
    discoveryPosition: { left: '58%', top: '53%' },
    nearest: '0.7 km',
    materialCompatibility: 'Carbon-filled PA12',
    productionTime: '3h 05m',
  },
  {
    id: 'MTL-CNC-N9',
    label: 'CNC',
    name: 'ForgeNode N9',
    status: 'offline',
    availability: 'busy',
    compatible: false,
    incompatibilityReason: 'Tooling mismatch',
    load: '00%',
    position: { left: '82%', top: '72%' },
    discoveryPosition: { left: '32%', top: '74%' },
    nearest: '6.4 km',
    materialCompatibility: 'Steel, aluminum',
    productionTime: 'Queue reserved',
  },
]

const gcodeLines = [
  'G21 ; metric units',
  'G90 ; absolute positioning',
  'M82 ; absolute extrusion mode',
  'M104 S218 ; set tool temperature',
  'M140 S72 ; set bed temperature',
  'M190 S72 ; wait for bed',
  'M109 S218 ; wait for tool',
  'G28 ; home all axes',
  'G92 E0',
  'G1 Z0.240 F900',
  ...Array.from({ length: 64 }, (_, index) => {
    const layer = Math.floor(index / 8) + 1
    const x = (36 + ((index * 7.41) % 82)).toFixed(2)
    const y = (24 + ((index * 5.83) % 78)).toFixed(2)
    const z = (0.24 + layer * 0.18).toFixed(2)
    const e = (0.018 + index * 0.037).toFixed(4)
    const feed = index % 6 === 0 ? 1320 : 1860

    if (index % 8 === 0) return `; LAYER ${String(layer).padStart(2, '0')} adaptive connector wall`
    if (index % 8 === 1) return `G1 Z${z} F900 ; layer height compensation`
    if (index % 8 === 2) return `G1 X${x} Y${y} E${e} F${feed} ; outer toolpath`
    if (index % 8 === 3) return `G1 X${(Number(x) + 8.6).toFixed(2)} Y${(Number(y) + 3.4).toFixed(2)} E${(Number(e) + 0.026).toFixed(4)} F${feed}`
    if (index % 8 === 4) return `G1 X${(Number(x) + 2.8).toFixed(2)} Y${(Number(y) + 11.2).toFixed(2)} E${(Number(e) + 0.044).toFixed(4)} F1680`
    if (index % 8 === 5) return `G2 X${(Number(x) + 5.2).toFixed(2)} Y${(Number(y) - 4.8).toFixed(2)} I2.40 J-1.60 E${(Number(e) + 0.061).toFixed(4)} ; pressure-fit radius`
    if (index % 8 === 6) return `M106 S${160 + (layer % 4) * 18} ; cooling channel`
    return `G1 X${(Number(x) - 6.2).toFixed(2)} Y${(Number(y) + 6.8).toFixed(2)} E${(Number(e) + 0.083).toFixed(4)} F2040 ; infill lattice`
  }),
  'G1 E-1.2000 F1800 ; retract',
  'G1 Z18.500 F1200 ; clear part',
  'M104 S0 ; tool off',
  'M140 S0 ; bed off',
  'M107 ; fan off',
  'M84 ; release motors',
  'M30 ; production job complete',
]

const productionStatuses = [
  [0, 'Initializing production node...'],
  [14, 'Streaming toolpaths...'],
  [36, 'Manufacturing in progress...'],
  [82, 'Finalizing surface pass...'],
  [100, 'Production complete'],
]

const transactionFeed = [
  ['Signature received', '0.4s'],
  ['Processed by leader', '0.8s'],
  ['Confirmed on Solana', '1.2s'],
]

const walletOptions = [
  {
    name: 'Solflare',
    address: '7MdK...9xQ2',
    note: 'Recommended for node authorization',
    detail: 'Fast settlement compatible',
    logo: 'solflare',
    primary: true,
  },
  {
    name: 'Phantom',
    address: '4VnA...2pLm',
    note: 'Operator signer',
    detail: 'Production route compatible',
    logo: 'phantom',
    primary: false,
  },
  {
    name: 'Backpack',
    address: '9TsR...7aKq',
    note: 'Execution signer',
    detail: 'Machine wallet compatible',
    logo: 'backpack',
    primary: false,
  },
]

const journey = [
  ['path', 'Manufacturing Path'],
  ['problem', 'AI Generation'],
  ['discovery', 'Route Job'],
  ['execution', 'Manufacture'],
  ['proof', 'Proof-of-Make'],
  ['settlement', 'Settlement'],
]

const problemPlaceholder = 'Describe the manufacturing problem you want to solve...'
const geometryPlaceholder = 'Optional: include dimensions, materials, or manufacturing constraints...'
const analysisMessages = [
  'Analyzing geometry...',
  'Extracting manufacturing constraints...',
  'Inferring adaptive topology...',
]

const launcherSteps = [
  ['upload', 'Upload Request'],
  ['preview', 'Production proposal'],
  ['brief', 'Production specification'],
  ['waiting', 'Waiting for Workshop'],
  ['offers', 'Offers received'],
  ['selected', 'Offer selected'],
]

function LauncherShell({ children, screen }) {
  return (
    <main className="launcher-os min-h-screen bg-[#050712] text-slate-100">
      <MachineNetworkBackground />
      <div className="launcher-shell">
        <nav className="launcher-topbar">
          <a href="/" className="launcher-brand" aria-label="Materialize home">
            <BrandMark />
            <span>
              <strong>Materialize</strong>
              <em>Launcher Demo Day</em>
            </span>
          </a>
          <div className="launcher-route-tabs">
            <a className={screen === 'customer' ? 'active' : ''} href="/launcher-demo">Customer Flow</a>
            <a className={screen === 'workshop' ? 'active' : ''} href="/launcher-workshop">Workshop Screen</a>
          </div>
        </nav>
        {children}
      </div>
    </main>
  )
}

function LauncherDemo() {
  const [activeStep, setActiveStep] = useState(0)
  const [offerDeclined, setOfferDeclined] = useState(false)
  const [offersRejected, setOffersRejected] = useState(false)
  const [productPreviewReady, setProductPreviewReady] = useState(true)
  const [currentStepId, currentStepLabel] = launcherSteps[activeStep]
  const requestDescription = 'Drveni privezak prečnika 5 cm, sa Materialize logom.'
  const stepCount = launcherSteps.length
  const canGoPrevious = activeStep > 0
  const canGoNext = activeStep < stepCount - 1

  const goPrevious = () => setActiveStep((step) => Math.max(0, step - 1))
  const goNext = () => setActiveStep((step) => Math.min(stepCount - 1, step + 1))
  const resetDemo = () => {
    setActiveStep(0)
    setOfferDeclined(false)
    setOffersRejected(false)
  }

  const selectCncOffer = () => {
    setOffersRejected(false)
    setOfferDeclined(false)
    setActiveStep(stepCount - 1)
  }

  return (
    <LauncherShell screen="customer">
      <section className="mobile-demo-layout">
        <div className="mobile-demo-intro">
          <p className="section-kicker">Mobile customer simulation</p>
          <h1>Customer request flow</h1>
          <p className="section-copy">A manual, frontend-only Demo Day mock for sending a small production request to a local workshop.</p>
        </div>

        <div className="phone-frame">
          <div className="phone-speaker" />
          <div className="phone-screen">
            <div className="phone-app-header">
              <BrandMark className="brand-mark-sm" />
              <span>
                <strong>Materialize</strong>
                <em>Customer request</em>
              </span>
            </div>

            <div className="phone-progress">
              {launcherSteps.map(([id], index) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`Go to step ${index + 1}`}
                  className={index === activeStep ? 'active' : index < activeStep ? 'complete' : ''}
                  onClick={() => {
                    setActiveStep(index)
                    if (index !== stepCount - 1) setOfferDeclined(false)
                    if (id !== 'offers') setOffersRejected(false)
                  }}
                />
              ))}
            </div>

            <div className="phone-step-meta">
              <span>{String(activeStep + 1).padStart(2, '0')} / {String(stepCount).padStart(2, '0')}</span>
              <strong>{currentStepLabel}</strong>
            </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStepId}
              className="phone-step-card"
              initial={{ opacity: 0, x: 22, filter: 'blur(8px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: -18, filter: 'blur(8px)' }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              {currentStepId === 'upload' ? (
                <>
                  <h2>Send production request</h2>
                  <button type="button" className="mobile-upload-card">
                    <UploadCloud className="h-7 w-7" />
                    <span>Upload image</span>
                    <em>Materialize logo mock asset</em>
                  </button>
                  <label className="mobile-field">
                    <span>Description</span>
                    <textarea value={requestDescription} readOnly />
                  </label>
                  <button type="button" className="mobile-primary-action" onClick={goNext}>
                    Send request
                    <Send className="h-4 w-4" />
                  </button>
                </>
              ) : null}

              {currentStepId === 'preview' ? (
                <>
                  <h2>Product concept prepared</h2>
                  <p className="mobile-support-copy">Materialize interpreted your uploaded logo and request as a wooden pendant / keychain.</p>
                  <div className="mobile-preview-card">
                    <p>Uploaded design: Materialize logo</p>
                    <div className="uploaded-logo-preview">
                      <img src={materializeLogo} alt="Materialize logo uploaded design preview" />
                    </div>
                  </div>
                  <div className="mobile-info-stack">
                    <span><em>Product</em><strong>Wooden pendant / keychain</strong></span>
                    <span><em>Diameter</em><strong>5 cm</strong></span>
                    <span><em>Material</em><strong>Wood</strong></span>
                    <span><em>Suggested process</em><strong>Laser engraving / CNC cutting</strong></span>
                  </div>
                  <button type="button" className="mobile-primary-action" onClick={goNext}>
                    Generate specification
                    <Sparkles className="h-4 w-4" />
                  </button>
                </>
              ) : null}

              {currentStepId === 'brief' ? (
                <>
                  <h2>Production specification created</h2>
                  <p className="mobile-support-copy">Materialize converted your request into a clear production specification.</p>
                  <div className="ai-product-preview-card">
                    <span>Proposed product preview</span>
                    {productPreviewReady ? (
                      <img
                        src="/launcher-demo/wooden-pendant-preview.png"
                        alt="Round wooden Materialize pendant product preview"
                        onError={() => setProductPreviewReady(false)}
                      />
                    ) : (
                      <div className="ai-product-preview-placeholder">Product preview pending</div>
                    )}
                    <p>Generated from uploaded logo and product description.</p>
                  </div>
                  <div className="mobile-brief-card">
                    {[
                      ['Product', 'Wooden pendant'],
                      ['Diameter', '5 cm'],
                      ['Material', 'Wood'],
                      ['Process', 'Laser engraving / CNC cutting'],
                      ['Quantity', 'Demo sample'],
                      ['Deadline', 'Demo Day'],
                    ].map(([label, value]) => (
                      <span key={label}><em>{label}</em><strong>{value}</strong></span>
                    ))}
                  </div>
                  <div className="mobile-status-line">
                    <span />
                    Finding compatible production partner...
                  </div>
                  <button type="button" className="mobile-primary-action" onClick={goNext}>
                    Route to workshop
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              ) : null}

              {currentStepId === 'waiting' ? (
                <>
                  <h2>Waiting for workshop response</h2>
                  <p className="mobile-support-copy">Your request was sent to CNC Axis-7 / Local workshop node.</p>
                  <div className="mobile-check-card">
                    <strong>Workshop is checking</strong>
                    <span>current queue</span>
                    <span>material compatibility</span>
                    <span>available production slot</span>
                  </div>
                  <div className="mobile-timeline">
                    {[
                      ['Request sent', 'done'],
                      ['Brief generated', 'done'],
                      ['Workshop notified', 'done'],
                      ['Waiting for acceptance', 'pending'],
                    ].map(([label, status]) => (
                      <span key={label} className={status}>
                        <CheckCircle2 className="h-4 w-4" />
                        {label}{status === 'pending' ? ' ...' : ''}
                      </span>
                    ))}
                  </div>
                  <button type="button" className="mobile-primary-action" onClick={goNext}>
                    Show offers
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              ) : null}

              {currentStepId === 'offers' ? (
                <>
                  <h2>Offers received</h2>
                  <p className="mobile-support-copy">Materialize matched your request with available local workshops.</p>
                  <div className="mobile-offers-list">
                    {[
                      ['CNC Axis-7', '1.500 RSD', 'Today, 16:00', 'Today, 14:30', 'Available production slot', true],
                      ['Laser Studio Niš', '1.800 RSD', 'Tomorrow, 11:00', 'Today, 18:00', 'Available', false],
                      ['Maker Workshop', '1.300 RSD', 'Tomorrow, 15:00', 'Today, 17:00', 'Longer production queue', false],
                    ].map(([workshop, price, readyBy, validUntil, status, primary]) => (
                      <div key={workshop} className={`mobile-workshop-offer ${primary ? 'featured' : ''}`}>
                        <div className="mobile-offer-heading">
                          <strong>{workshop}</strong>
                          <em>{status}</em>
                        </div>
                        <div className="mobile-offer-details">
                          <span><em>Price</em><strong>{price}</strong></span>
                          <span><em>Ready by</em><strong>{readyBy}</strong></span>
                          <span><em>Offer valid until</em><strong>{validUntil}</strong></span>
                        </div>
                        {primary ? (
                          <button type="button" className="mobile-primary-action" onClick={selectCncOffer}>Select offer</button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button type="button" className="mobile-secondary-action" onClick={() => setOffersRejected(true)}>Reject all offers</button>
                  {offersRejected ? (
                    <div className="mobile-decline-message">
                      All current offers were declined. Materialize can search for additional compatible workshops.
                    </div>
                  ) : null}
                </>
              ) : null}

              {currentStepId === 'selected' ? (
                <>
                  <div className="mobile-success-mark">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <h2>Offer selected</h2>
                  <p className="mobile-support-copy">You selected CNC Axis-7. Confirm your order to reserve this production slot.</p>
                  <div className="mobile-offer-card">
                    <span><em>Estimated price</em><strong>1.500 RSD</strong></span>
                    <span><em>Pickup</em><strong>Naučno-tehnološki park Niš</strong></span>
                    <span><em>Ready by</em><strong>Today, 16:00</strong></span>
                    <span><em>Offer valid until</em><strong>Today, 14:30</strong></span>
                    <span><em>Status</em><strong>Waiting for your confirmation.</strong></span>
                    <p>Confirm within 30 minutes to keep the scheduled pickup time.</p>
                  </div>
                  <div className="mobile-system-note">
                    Other workshops will be notified if this offer is confirmed.
                  </div>
                  <div className="mobile-offer-actions">
                    <button type="button" className="mobile-primary-action">Confirm order</button>
                    <button type="button" className="mobile-secondary-action" onClick={() => setOfferDeclined(true)}>Find another workshop</button>
                  </div>
                  {offerDeclined ? (
                    <div className="mobile-decline-message">
                      Materialize can route your request to another compatible workshop.
                    </div>
                  ) : null}
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>

            <div className="mobile-demo-controls">
              <button type="button" onClick={goPrevious} disabled={!canGoPrevious}>Previous</button>
              <button type="button" onClick={goNext} disabled={!canGoNext}>Next</button>
              <button type="button" onClick={resetDemo}>Reset demo</button>
            </div>
          </div>
        </div>

        <div className="mobile-demo-step-list">
          {launcherSteps.map(([id, label], index) => (
            <button
              key={id}
              type="button"
              className={index === activeStep ? 'active' : ''}
              onClick={() => setActiveStep(index)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {label}
            </button>
          ))}
        </div>
      </section>
    </LauncherShell>
  )
}

function LauncherWorkshop() {
  const [mode, setMode] = useState('standby')
  const [notificationVisible, setNotificationVisible] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search)
    return searchParams.get('present') !== '1'
  })
  const requestTimerRef = useRef(null)

  const clearRequestTimer = useCallback(() => {
    if (!requestTimerRef.current) return
    window.clearTimeout(requestTimerRef.current)
    requestTimerRef.current = null
  }, [])

  const showRequest = useCallback(() => {
    clearRequestTimer()
    setNotificationVisible(true)
    setMode('notifying')
    requestTimerRef.current = window.setTimeout(() => {
      setMode('request')
      requestTimerRef.current = null
    }, 850)
  }, [clearRequestTimer])

  const acceptJob = useCallback(() => {
    clearRequestTimer()
    setNotificationVisible(false)
    setMode('accepted')
  }, [clearRequestTimer])

  const resetDemo = useCallback(() => {
    clearRequestTimer()
    setNotificationVisible(false)
    setMode('standby')
  }, [clearRequestTimer])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code === 'Space' || event.key.toLowerCase() === 'n') {
        event.preventDefault()
        showRequest()
      }
      if (event.key.toLowerCase() === 'a') acceptJob()
      if (event.key.toLowerCase() === 'r') resetDemo()
      if (event.key.toLowerCase() === 'h') setControlsVisible((visible) => !visible)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [acceptJob, resetDemo, showRequest])

  useEffect(() => () => clearRequestTimer(), [clearRequestTimer])

  return (
    <LauncherShell screen="workshop">
      <section className="workshop-screen">
        <div className="workshop-header">
          <div>
            <p className="section-kicker">Nenad's laptop screen</p>
            <h1>WORKSHOP NODE STANDBY</h1>
          </div>
          <div className={`workshop-status-light ${mode}`}>
            <span />
            {mode === 'accepted' ? 'Job accepted' : mode === 'request' || mode === 'notifying' ? 'New request' : 'Standby'}
          </div>
        </div>

        {!controlsVisible ? (
          <div className="presentation-mode-chip">Presentation Mode</div>
        ) : null}

        <AnimatePresence>
          {notificationVisible ? (
            <motion.div
              className="workshop-notification"
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
            >
              <div className="notification-icon"><Mail className="h-5 w-5" /></div>
              <div>
                <div className="notification-meta">
                  <strong>NEW REQUEST</strong>
                  <span>just now</span>
                </div>
                <h2>New production request received</h2>
                <p>From: Materialize Routing Agent</p>
                <p>Customer: Small gift brand</p>
                <p>Product: Personalized wooden tags</p>
                <p>Action required: Review production queue</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className={`workshop-grid ${controlsVisible ? '' : 'presentation'}`}>
          <div className="workshop-console surface">
            {mode === 'standby' ? (
              <motion.div className="standby-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Cpu className="h-16 w-16 text-amber-200" />
                <h2>WORKSHOP NODE STANDBY</h2>
                <p>Waiting for production requests...</p>
                <div className="standby-inbox-card">
                  <Inbox className="h-5 w-5 text-amber-200" />
                  <span>
                    <strong>Workshop inbox</strong>
                    <em>No new requests</em>
                    <small>Machine queue: 3 active jobs</small>
                  </span>
                </div>
              </motion.div>
            ) : null}

            {mode === 'notifying' ? (
              <motion.div className="notification-hold-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Inbox className="h-14 w-14 text-amber-200" />
                <h2>INBOX ALERT RECEIVED</h2>
                <p>Materialize Routing Agent is opening the production request...</p>
              </motion.div>
            ) : null}

            {mode === 'request' ? (
              <motion.div className="request-alert-panel" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                <div className="inbox-received-chip">
                  <Inbox className="h-4 w-4" />
                  Inbox notification received
                </div>
                <div className="request-alert-title">
                  <Play className="h-8 w-8" />
                  <h2>NEW PRODUCTION REQUEST</h2>
                </div>
                <div className="workshop-request-grid">
                  {[
                    ['Product', 'Personalized wooden tags'],
                    ['Quantity', '30'],
                    ['Material', 'Wood'],
                    ['Process', 'Laser / CNC engraving'],
                    ['Customer deadline', 'Next Friday'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="queue-list">
                  <h3>Current queue</h3>
                  <p>Job #1 finishing today</p>
                  <p>Job #2 scheduled tomorrow</p>
                  <p>Job #3 scheduled Thursday</p>
                </div>
                <div className="recommendation-box">
                  <Sparkles className="h-5 w-5 text-amber-200" />
                  <span>
                    <strong>Materialize recommendation</strong>
                    This job can be completed by Friday, 16:00.
                  </span>
                </div>
                <div className="workshop-action-row">
                  <button type="button" className="brand-button" onClick={acceptJob}>ACCEPT JOB</button>
                  <button type="button"><HelpCircle className="h-4 w-4" /> ASK QUESTION</button>
                  <button type="button"><XCircle className="h-4 w-4" /> DECLINE</button>
                </div>
              </motion.div>
            ) : null}

            {mode === 'accepted' ? (
              <motion.div className="job-accepted-panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
                <CheckCircle2 className="h-20 w-20 text-amber-200" />
                <h2>JOB ACCEPTED</h2>
                <p>Customer notified.</p>
                <strong>Production slot reserved: Friday, 16:00.</strong>
                <span>Status: In production queue.</span>
              </motion.div>
            ) : null}
          </div>

          {controlsVisible ? (
            <aside className="workshop-side surface">
              <h2>Demo controls</h2>
              <button type="button" onClick={showRequest}><Play className="h-4 w-4" /> Show Request</button>
              <button type="button" onClick={acceptJob}><CheckCircle2 className="h-4 w-4" /> Accept Job</button>
              <button type="button" onClick={resetDemo}><RotateCcw className="h-4 w-4" /> Reset</button>
              <div className="shortcut-list">
                <span><kbd>Space</kbd> or <kbd>N</kbd> New request</span>
                <span><kbd>A</kbd> Accept job</span>
                <span><kbd>R</kbd> Reset demo</span>
                <span><kbd>H</kbd> Toggle controls</span>
              </div>
            </aside>
          ) : null}
        </div>
      </section>
    </LauncherShell>
  )
}

function BrandMark({ className = '' }) {
  return (
    <span className={`brand-mark ${className}`}>
      <img src={materializeLogo} alt="Materialize cube logo" />
    </span>
  )
}

function WalletLogo({ wallet, className = '' }) {
  return (
    <span className={`wallet-logo wallet-logo-${wallet.logo} ${className}`}>
      <span />
    </span>
  )
}

function WalletModal({ onClose, onSelect }) {
  return (
    <motion.div
      className="wallet-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="wallet-modal"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-5 border-b border-white/10 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-amber-200">Wallet router</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Authorize production wallet</h3>
          </div>
          <button type="button" className="wallet-close" onClick={onClose}>Close</button>
        </div>
        <div className="grid gap-3 p-4">
          {walletOptions.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              className={`wallet-option ${wallet.primary ? 'primary' : ''}`}
              onClick={() => onSelect(wallet)}
            >
              <WalletLogo wallet={wallet} className="wallet-option-mark" />
              <span>
                <strong>{wallet.name}</strong>
                <em>{wallet.note}</em>
                <em>{wallet.detail}</em>
              </span>
              {wallet.primary ? <small>Preferred</small> : null}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

function MachineNetworkBackground() {
  const nodes = [
    { x: '14%', y: '24%', delay: 0 },
    { x: '34%', y: '14%', delay: 0.4 },
    { x: '58%', y: '26%', delay: 0.8 },
    { x: '79%', y: '16%', delay: 1.1 },
    { x: '23%', y: '58%', delay: 1.4 },
    { x: '48%', y: '70%', delay: 0.7 },
    { x: '73%', y: '58%', delay: 0.2 },
    { x: '88%', y: '78%', delay: 1.7 },
  ]

  return (
    <div className="network-bg" aria-hidden="true">
      <div className="network-grid" />
      <svg className="network-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        <motion.path
          d="M14 24 L34 14 L58 26 L79 16 M34 14 L23 58 L48 70 L73 58 L88 78 M58 26 L73 58 M23 58 L14 24"
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="0.18"
          strokeLinecap="round"
          pathLength="1"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.7 }}
          transition={{ duration: 2.8, ease: 'easeInOut' }}
        />
        <defs>
          <linearGradient id="lineGradient" x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#f8b84e" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#e8507f" />
          </linearGradient>
        </defs>
      </svg>
      {nodes.map((node) => (
        <motion.span
          key={`${node.x}-${node.y}`}
          className="machine-node"
          style={{ left: node.x, top: node.y }}
          animate={{ scale: [1, 1.35, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 3, delay: node.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

function ProductVisual({ product }) {
  if (product.shape === 'connector') {
    return (
      <div className={`product-visual product-connector connector-variant-${product.variant ?? 'adaptive'}`}>
        <div className="connector-blueprint" />
        <div className="connector-telemetry connector-telemetry-a" />
        <div className="connector-telemetry connector-telemetry-b" />
        <div className="connector-cad" aria-hidden="true">
          <div className="connector-cap" />
          <div className="connector-cage">
            <span className="connector-strut connector-strut-left" />
            <span className="connector-strut connector-strut-mid-left" />
            <span className="connector-body" />
            <span className="connector-strut connector-strut-mid-right" />
            <span className="connector-strut connector-strut-right" />
          </div>
          <div className="connector-band" />
          <div className="connector-thread-stack">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="connector-base" />
        </div>
        <span className="scan-beam" />
      </div>
    )
  }

  return (
    <div className={`product-visual product-${product.shape}`}>
      <div className={`product-core bg-gradient-to-br ${product.accent}`} />
      <span className="scan-beam" />
    </div>
  )
}

function MaterializeApp() {
  const [selectedProduct, setSelectedProduct] = useState(products[0])
  const [selectedMachine, setSelectedMachine] = useState(machines[0])
  const [wallet, setWallet] = useState(null)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [problemPrompt, setProblemPrompt] = useState('')
  const [geometryHints, setGeometryHints] = useState('')
  const [focusedField, setFocusedField] = useState(null)
  const [placeholderTick, setPlaceholderTick] = useState(0)
  const [generationState, setGenerationState] = useState('idle')
  const [referenceImages, setReferenceImages] = useState([])
  const [imageAnalysisState, setImageAnalysisState] = useState('idle')
  const [analysisMessageIndex, setAnalysisMessageIndex] = useState(0)
  const [executionProgress, setExecutionProgress] = useState(0)
  const [executionRunning, setExecutionRunning] = useState(false)
  const stepRefs = useRef([])
  const touchStartX = useRef(null)
  const terminalFeedRef = useRef(null)

  const proofTime = '2026-05-08 21:44 UTC'
  const routedMachine = selectedMachine.compatible ? selectedMachine : (machines.find((machine) => machine.compatible) ?? machines[0])
  const walletName = wallet ? `${wallet.name} Connected` : 'Connection Required'
  const walletAddress = wallet?.address ?? 'Signer Required'
  const routeStatus = wallet ? 'Production Route Authorized' : 'Authorizing production route...'
  const executionStatus = wallet ? 'Manufacturing execution ready' : 'Manufacturing execution standby'
  const activeJourney = journey[activeStep]
  const activeStepId = activeJourney[0]
  const progressWidth = `${(activeStep / (journey.length - 1)) * 100}%`
  const placeholderCycleLength = Math.max(problemPlaceholder.length, geometryPlaceholder.length) + 46
  const problemPlaceholderText = problemPlaceholder.slice(0, Math.min(placeholderTick, problemPlaceholder.length))
  const geometryPlaceholderText = geometryPlaceholder.slice(0, Math.min(Math.max(placeholderTick - 8, 0), geometryPlaceholder.length))
  const analysisActive = imageAnalysisState === 'analyzing'
  const currentAnalysisMessage = analysisMessages[analysisMessageIndex] ?? analysisMessages[0]
  const activeGcodeLine = Math.min(gcodeLines.length - 1, Math.floor((executionProgress / 100) * (gcodeLines.length - 1)))
  const productionStatus = productionStatuses.reduce((status, [threshold, label]) => (
    executionProgress >= threshold ? label : status
  ), productionStatuses[0][1])
  const executionComplete = executionProgress >= 100
  const layerCount = Math.min(8, Math.max(1, Math.ceil((executionProgress / 100) * 8)))
  const toolTemperature = executionComplete ? 42 : Math.round(188 + Math.min(executionProgress, 72) * 0.42)
  const spindleLoad = executionComplete ? 'idle' : `${Math.round(38 + Math.sin(executionProgress / 11) * 8 + executionProgress * 0.34)}%`
  const estimatedCompletion = executionComplete ? 'Complete' : `${Math.max(1, Math.ceil((100 - executionProgress) / 15))}m`

  const goToStep = (index) => {
    setActiveStep(Math.min(Math.max(index, 0), journey.length - 1))
  }

  const goNext = () => goToStep(activeStep + 1)
  const goPrevious = () => goToStep(activeStep - 1)

  const startGeneration = () => {
    if (generationState === 'generating') return
    setGenerationState('generating')
  }

  const handleReferenceUpload = (event) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!files.length) return

    setReferenceImages((currentImages) => {
      currentImages.forEach((image) => URL.revokeObjectURL(image.url))

      return files.slice(0, 4).map((file) => ({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        url: URL.createObjectURL(file),
      }))
    })
    setImageAnalysisState('analyzing')
    setAnalysisMessageIndex(0)
  }

  const handlePrimaryNext = () => {
    if (activeJourney[0] === 'problem') {
      if (generationState === 'idle') {
        startGeneration()
        return
      }

      if (generationState === 'generated') {
        goNext()
      }

      return
    }

    goNext()
  }

  const handleStepSelect = (index) => {
    if (index > 1 && generationState !== 'generated') {
      goToStep(1)
      startGeneration()
      return
    }

    goToStep(index)
  }

  const handleTouchStart = (event) => {
    if (event.target.closest('.workflow-grid-wide')) return
    touchStartX.current = event.touches[0].clientX
  }

  const handleTouchEnd = (event) => {
    if (touchStartX.current === null) return

    const distance = event.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null

    if (Math.abs(distance) < 54) return
    if (distance < 0) handlePrimaryNext()
    if (distance > 0) goPrevious()
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (walletModalOpen) return
      if (event.key === 'ArrowRight') {
        if (activeStep === 1) {
          if (generationState === 'idle') setGenerationState('generating')
          if (generationState === 'generated') goToStep(activeStep + 1)
          return
        }

        goToStep(activeStep + 1)
      }
      if (event.key === 'ArrowLeft') goToStep(activeStep - 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeStep, walletModalOpen, generationState])

  useEffect(() => {
    stepRefs.current[activeStep]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [activeStep])

  useEffect(() => {
    if (generationState !== 'generating') return undefined

    const timer = window.setTimeout(() => {
      setGenerationState('generated')
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [generationState])

  useEffect(() => {
    if (activeStepId !== 'execution') return undefined

    let animationFrame = 0
    const duration = 8200
    let start = 0

    const tick = (now) => {
      if (!start) {
        start = now
        setExecutionProgress(0)
        setExecutionRunning(true)
      }

      const elapsed = Math.min((now - start) / duration, 1)
      const eased = elapsed < 0.5
        ? 4 * elapsed * elapsed * elapsed
        : 1 - ((-2 * elapsed + 2) ** 3) / 2

      setExecutionProgress(Math.min(100, Math.round(eased * 100)))

      if (elapsed < 1) {
        animationFrame = window.requestAnimationFrame(tick)
        return
      }

      setExecutionProgress(100)
      setExecutionRunning(false)
    }

    animationFrame = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      setExecutionRunning(false)
    }
  }, [activeStepId])

  useEffect(() => {
    if (!terminalFeedRef.current || activeStepId !== 'execution') return

    const terminal = terminalFeedRef.current
    const activeLine = terminal.querySelector(`[data-line-index="${activeGcodeLine}"]`)

    if (activeLine) {
      terminal.scrollTo({
        top: Math.max(0, activeLine.offsetTop - terminal.clientHeight * 0.48),
        behavior: executionComplete ? 'auto' : 'smooth',
      })
    }
  }, [activeGcodeLine, activeStepId, executionComplete])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlaceholderTick((tick) => (tick + 1) % placeholderCycleLength)
    }, 42)

    return () => window.clearInterval(timer)
  }, [placeholderCycleLength])

  useEffect(() => {
    if (imageAnalysisState !== 'analyzing') return undefined

    const timer = window.setTimeout(() => {
      if (analysisMessageIndex >= analysisMessages.length - 1) {
        setImageAnalysisState('complete')
        return
      }

      setAnalysisMessageIndex((index) => index + 1)
    }, analysisMessageIndex >= analysisMessages.length - 1 ? 720 : 860)

    return () => window.clearTimeout(timer)
  }, [analysisMessageIndex, imageAnalysisState])

  useEffect(() => (
    () => {
      referenceImages.forEach((image) => URL.revokeObjectURL(image.url))
    }
  ), [referenceImages])

  const slideHeader = {
    path: [
      'Decentralized manufacturing platform',
      'Generated. Routed. Manufactured.',
      'AI-generated parts routed through decentralized production nodes.',
    ],
    problem: [
      'AI Generation',
      'Generate production-ready solution variants.',
      'Describe the manufacturing problem, add reference context, and synthesize adaptive parts ready for decentralized production routing.',
    ],
    discovery: [
      'Route Job',
      'Find compatible decentralized machine nodes.',
      'Materialize matches the generated part to nearby production nodes by compatibility, distance, availability, and production ETA.',
    ],
    execution: [
      'Manufacture',
      'Execute the job on the selected local node.',
      'Monitor machine telemetry, toolpath streaming, progress, and estimated completion as the part is manufactured locally.',
    ],
    proof: [
      'Proof-of-Make',
      'Verify local manufacturing completion.',
      'Inspect the machine-submitted completion proof, machine ID, job hash, timestamp, and production status.',
    ],
    settlement: [
      'SOL settlement',
      'Confirm reward routing and platform settlement.',
      'Visualize SOL payment routing, machine node reward, platform fee, and transaction confirmation.',
    ],
  }

  const renderSlide = () => {
    const [id] = activeJourney

    if (id === 'path') {
      return (
        <div className="path-selection-grid">
          <motion.button
            type="button"
            className="surface production-path-card active"
            onClick={() => goNext()}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42 }}
          >
            <div className="path-card-visual">
              <Sparkles className="h-8 w-8 text-amber-200" />
              <span />
            </div>
            <div>
              <p className="path-card-kicker">Active workflow</p>
              <h3>AI Solution Generation</h3>
              <p>Generate a custom manufacturable solution using AI-assisted adaptive geometry synthesis.</p>
            </div>
            <strong className="path-card-cta">
              Start Generation
              <ArrowRight className="h-4 w-4" />
            </strong>
          </motion.button>

          {[
            {
              title: 'Upload Production Files',
              description: 'Upload ready-to-manufacture CAD, STL, or G-code files for decentralized production routing.',
              icon: UploadCloud,
            },
            {
              title: 'Manufacturing Marketplace',
              description: 'Browse reusable manufacturing templates and production-ready component catalogs.',
              icon: Box,
            },
          ].map((path, index) => {
            const Icon = path.icon

            return (
              <motion.div
                key={path.title}
                className="surface production-path-card disabled"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, delay: (index + 1) * 0.08 }}
                aria-disabled="true"
              >
                <div className="path-card-badge">COMING SOON</div>
                <div className="path-card-visual">
                  <Icon className="h-8 w-8 text-violet-200" />
                  <span />
                </div>
                <div>
                  <p className="path-card-kicker">Planned workflow</p>
                  <h3>{path.title}</h3>
                  <p>{path.description}</p>
                </div>
              </motion.div>
            )
          })}
        </div>
      )
    }

    if (id === 'problem') {
      const isGenerating = generationState === 'generating'
      const isGenerated = generationState === 'generated'

      return (
        <div className="workflow-grid problem-input-grid lg:grid-cols-[0.95fr_1.05fr]">
          <div className="surface problem-input-panel">
            <div className="problem-input-header">
              <Sparkles className="h-5 w-5 text-amber-200" />
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Manufacturing problem</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">Generate a production-ready part</h3>
              </div>
            </div>

            <label className="reference-upload">
              <input type="file" accept="image/*" multiple onChange={handleReferenceUpload} />
              <UploadCloud className="h-6 w-6 text-amber-200" />
              <span>
                <strong>Upload reference images</strong>
                <em>Pipe ends, broken components, scans, or workshop photos</em>
              </span>
            </label>

            {referenceImages.length ? (
              <div className="reference-preview-grid">
                <AnimatePresence>
                  {referenceImages.map((image) => (
                    <motion.div
                      key={image.id}
                      className="reference-preview-card"
                      initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: -8, filter: 'blur(8px)' }}
                      transition={{ duration: 0.28, ease: 'easeOut' }}
                    >
                      <img src={image.url} alt="" />
                      <div>
                        <strong>{image.name || 'Reference image loaded'}</strong>
                        <span><CheckCircle2 className="h-3.5 w-3.5" /> Reference image loaded</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            ) : null}

            <label className="problem-field">
              <span><Image className="h-4 w-4" /> Problem description</span>
              <div className="ai-input-shell textarea-shell">
                <textarea
                  value={problemPrompt}
                  onFocus={() => setFocusedField('problem')}
                  onBlur={() => setFocusedField(null)}
                  onChange={(event) => setProblemPrompt(event.target.value)}
                />
                <span className={`animated-placeholder ${problemPrompt || focusedField === 'problem' ? 'hidden' : ''}`}>
                  {problemPlaceholderText}
                  <i />
                </span>
              </div>
            </label>

            <label className="problem-field">
              <span><Ruler className="h-4 w-4" /> Geometry / Constraints</span>
              <div className="ai-input-shell">
                <input
                  type="text"
                  value={geometryHints}
                  onFocus={() => setFocusedField('geometry')}
                  onBlur={() => setFocusedField(null)}
                  onChange={(event) => setGeometryHints(event.target.value)}
                />
                <span className={`animated-placeholder ${geometryHints || focusedField === 'geometry' ? 'hidden' : ''}`}>
                  {geometryPlaceholderText}
                  <i />
                </span>
              </div>
            </label>

            <div className="problem-chip-row">
              <span>Pressure fit</span>
              <span>Field repair</span>
              <span>CNC + additive</span>
              <span>Local node ready</span>
            </div>

            <button type="button" className="problem-generate-button" onClick={startGeneration} disabled={isGenerating}>
              {isGenerating ? 'Generating...' : isGenerated ? 'Regenerate solutions' : 'Generate manufacturable solutions'}
              <Sparkles className="h-4 w-4" />
            </button>
          </div>

          <div className="surface generation-panel">
            <div className={`generation-core ${generationState} ${analysisActive ? 'analyzing' : ''}`}>
              <div className="generation-orbit generation-orbit-a" />
              <div className="generation-orbit generation-orbit-b" />
              <div className="generation-orbit generation-orbit-c" />
              {!isGenerated ? (
                <div className="ai-fabrication-placeholder" aria-hidden="true">
                  <div className="ai-wireframe">
                    <span className="wireframe-axis wireframe-axis-x" />
                    <span className="wireframe-axis wireframe-axis-y" />
                    <span className="wireframe-axis wireframe-axis-z" />
                  </div>
                  <div className="ai-scan-grid" />
                  <div className="ai-particle-field">
                    {Array.from({ length: 12 }).map((_, index) => (
                      <span key={index} style={{ '--particle-index': index }} />
                    ))}
                  </div>
                </div>
              ) : (
                <motion.div
                  className="generated-connector-reveal"
                  initial={{ opacity: 0, scale: 0.92, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.52, ease: 'easeOut' }}
                >
                  <ProductVisual product={selectedProduct} />
                </motion.div>
              )}
            </div>

            <div className="generation-status">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">AI fabrication engine</p>
              {referenceImages.length ? (
                <div className={`analysis-status-pill ${imageAnalysisState}`}>
                  <span />
                  {analysisActive ? currentAnalysisMessage : 'Reference images verified'}
                </div>
              ) : null}
              <h3 className="mt-2 text-2xl font-semibold text-white">
                {analysisActive ? currentAnalysisMessage : isGenerating ? 'Generating manufacturable solutions...' : isGenerated ? 'Manufacturing-ready variants synthesized' : 'Waiting for adaptive geometry synthesis'}
              </h3>
              <p className="mt-3 leading-7 text-slate-400">
                {analysisActive
                  ? 'Uploaded references are being converted into geometry cues, fit constraints, and manufacturable topology targets.'
                  : isGenerated
                  ? 'Three connector solutions are packaged with material strategy, machine compatibility, and decentralized production routing.'
                  : isGenerating
                    ? 'Materialize is inferring geometry, validating fabrication constraints, and searching the local production graph.'
                    : referenceImages.length
                      ? 'Reference images are verified and ready to guide adaptive geometry synthesis.'
                      : 'Reference data and manufacturing constraints are staged for AI synthesis.'}
              </p>
            </div>

            <div className="generation-sequence">
              {['Extract constraints', 'Infer geometry', 'Synthesize variants', 'Validate production'].map((item, index) => (
                <div key={item} className={`generation-step ${isGenerating || isGenerated ? 'active' : ''} ${isGenerated ? 'complete' : ''}`} style={{ transitionDelay: `${index * 120}ms` }}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{item}</strong>
                </div>
              ))}
            </div>

            {isGenerated ? (
              <div className="generated-variant-strip">
                {products.map((product) => (
                  <button
                    key={product.name}
                    type="button"
                    className={`generated-variant-chip ${selectedProduct.name === product.name ? 'active' : ''}`}
                    onClick={() => setSelectedProduct(product)}
                  >
                    <span>{product.name}</span>
                    <strong>{product.type}</strong>
                    <em>{product.time} / {product.compatibility.join(' + ')}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )
    }

    if (id === 'discovery') {
      const discoveryMachines = machines.slice(0, 3)
      const compatibleMachines = discoveryMachines.filter((machine) => machine.compatible)
      const activeDiscoveryMachine = compatibleMachines.find((machine) => machine.id === selectedMachine.id) ?? compatibleMachines[0]
      const routePath = `M22 46 L${parseInt(activeDiscoveryMachine.discoveryPosition.left, 10)} ${parseInt(activeDiscoveryMachine.discoveryPosition.top, 10)}`

      return (
        <div className="workflow-grid discovery-production-grid lg:grid-cols-[0.82fr_1.18fr]">
          <div className="surface component-inspection-panel">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Selected component</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{selectedProduct.name}</h3>
            <div className="component-inspection-visual">
              <ProductVisual product={selectedProduct} />
            </div>
            <div className="mt-5 grid gap-3">
              <div className="component-spec-row">
                <span>Material type</span>
                <strong>{selectedProduct.material ?? 'Production polymer'}</strong>
              </div>
              <div className="component-spec-row">
                <span>Estimated duration</span>
                <strong>{selectedProduct.time}</strong>
              </div>
              <div className="component-spec-row">
                <span>Manufacturing state</span>
                <strong className="text-amber-200">Production-ready</strong>
              </div>
            </div>
          </div>

          <div className="surface production-discovery-panel">
            <div className="production-map">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="discovery-lines">
                <motion.path
                  d="M22 46 L58 53 L74 27 M58 53 L80 72"
                  fill="none"
                  stroke="rgba(139, 92, 246, 0.36)"
                  strokeWidth="0.22"
                  strokeLinecap="round"
                  pathLength="1"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.1 }}
                />
                <motion.path
                  key={activeDiscoveryMachine.id}
                  d={routePath}
                  fill="none"
                  stroke="url(#productionRouteGradient)"
                  strokeWidth="0.52"
                  strokeLinecap="round"
                  pathLength="1"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.75, ease: 'easeOut' }}
                />
                <defs>
                  <linearGradient id="productionRouteGradient" x1="0" x2="1">
                    <stop stopColor="#f8b84e" />
                    <stop offset="1" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>

              <div className="user-location-node" style={{ left: '22%', top: '46%' }}>
                <span />
                <strong>Your location</strong>
                <em>Region: Belgrade - Serbia</em>
              </div>

              {discoveryMachines.map((machine) => (
                <button
                  key={machine.id}
                  type="button"
                  disabled={!machine.compatible}
                  className={`production-node ${machine.compatible ? machine.availability : 'incompatible'} ${activeDiscoveryMachine.id === machine.id ? 'active' : ''}`}
                  style={machine.discoveryPosition}
                  onClick={() => {
                    if (!machine.compatible) return
                    setSelectedMachine(machine)
                  }}
                >
                  <span className="node-dot" />
                  <strong>{machine.name}</strong>
                  <em>{machine.compatible ? machine.nearest : machine.incompatibilityReason}</em>
                </button>
              ))}
            </div>

            <div className="production-node-list">
              <div className="route-established">
                <Radio className="h-4 w-4" />
                Production route established
              </div>
              <div className="route-capability-badge">
                <SmartphoneNfc className="h-4 w-4" />
                NFC pickup verification supported
              </div>
              {discoveryMachines.map((machine) => (
                <button
                  key={machine.id}
                  type="button"
                  disabled={!machine.compatible}
                  className={`node-detail-card ${machine.compatible ? machine.availability : 'incompatible'} ${activeDiscoveryMachine.id === machine.id ? 'active' : ''}`}
                  onClick={() => {
                    if (!machine.compatible) return
                    setSelectedMachine(machine)
                  }}
                >
                  <div>
                    <strong>{machine.name}</strong>
                    <span>{machine.compatible ? `${machine.label} production node` : machine.incompatibilityReason}</span>
                  </div>
                  <div className="node-detail-grid">
                    <span><em>Distance</em>{machine.nearest}</span>
                    <span><em>Availability</em>{machine.compatible ? machine.availability : 'unsupported'}</span>
                    <span><em>Material</em>{machine.materialCompatibility}</span>
                    <span><em>ETA</em>{machine.productionTime}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (id === 'execution') {
      return (
        <div className="workflow-grid lg:grid-cols-[1.05fr_0.95fr]">
          <div className="dashboard-shell">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Decentralized production job</p>
                <h3 className="mt-1 text-xl font-semibold text-white">{selectedProduct.name}</h3>
              </div>
              <div className={`execution-state-pill ${executionComplete ? 'complete' : executionRunning ? 'running' : ''}`}>
                <span />
                {executionComplete ? 'Proof-of-Make Generated' : productionStatus}
              </div>
            </div>
            <div className="p-5">
              <div className="mb-3 flex justify-between text-sm">
                <span className="text-slate-400">{productionStatus}</span>
                <span className="font-medium text-white">{executionProgress}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/8">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-amber-300 via-pink-400 to-violet-400"
                  animate={{ width: `${executionProgress}%` }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {executionComplete ? (
                  <span className="production-complete-badge"><CheckCircle2 className="h-4 w-4" /> Production Complete</span>
                ) : (
                  <span className="production-live-badge"><Timer className="h-4 w-4" /> Live execution</span>
                )}
                <span className="production-live-badge muted">Machine node {routedMachine.id}</span>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="metric-card"><span>Layer count</span><strong>{layerCount}/8</strong></div>
                <div className="metric-card"><span>Tool temperature</span><strong>{toolTemperature}C</strong></div>
                <div className="metric-card"><span>ETA</span><strong>{estimatedCompletion}</strong></div>
                <div className="metric-card"><span>Machine node</span><strong>{routedMachine.id}</strong></div>
                <div className="metric-card"><span>Material</span><strong>{selectedProduct.material}</strong></div>
                <div className="metric-card"><span>Tool status</span><strong>{spindleLoad}</strong></div>
              </div>
            </div>
          </div>
          <div className="terminal-panel">
            <div className="terminal-header">
              <span><Terminal className="h-4 w-4 text-violet-200" /> Toolpath stream</span>
              <strong>{executionComplete ? 'COMPLETE' : `LINE ${String(activeGcodeLine + 1).padStart(2, '0')}`}</strong>
            </div>
            <div className="terminal-feed" ref={terminalFeedRef}>
              {gcodeLines.map((line, index) => (
                <motion.p
                  key={`${index}-${line}`}
                  data-line-index={index}
                  className={`gcode-line ${index === activeGcodeLine ? 'active' : ''} ${index < activeGcodeLine ? 'complete' : ''}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.24, delay: Math.min(index * 0.012, 0.5) }}
                >
                  <span>{String(index + 1).padStart(3, '0')}</span>
                  <code>{line}</code>
                </motion.p>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (id === 'proof') {
      return (
        <div className="certificate workflow-certificate">
          <motion.div
            className="success-ring"
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 160, damping: 14 }}
          >
            <BadgeCheck className="h-14 w-14 text-amber-200" />
          </motion.div>
          <div>
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-amber-200"><BrandMark className="brand-mark-xs" /> Machine-submitted completion proof</p>
            <h3 className="mt-2 text-3xl font-semibold tracking-tight text-white">{selectedProduct.name}</h3>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              <div className="proof-field"><span>Job hash</span><strong>{selectedProduct.txHash}</strong></div>
              <div className="proof-field"><span>Machine ID</span><strong>{routedMachine.id}</strong></div>
              <div className="proof-field"><span>Timestamp</span><strong>{proofTime}</strong></div>
              <div className="proof-field"><span>Production status</span><strong>Manufactured locally</strong></div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="chain-confirm"><CheckCircle2 className="h-4 w-4" />Verified node</div>
              <div className="chain-confirm"><CheckCircle2 className="h-4 w-4" />Payment confirmed</div>
              <div className="chain-confirm"><CheckCircle2 className="h-4 w-4" />Machine rewarded</div>
              <div className="chain-confirm"><CheckCircle2 className="h-4 w-4" />Proof sealed</div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="workflow-grid lg:grid-cols-[1fr_0.9fr]">
        <div className="settlement-flow surface p-6">
          <div className="wallet-node">
            <Wallet className="h-6 w-6 text-violet-200" />
            <span>{walletName}</span>
            <strong>{selectedProduct.cost}</strong>
            <em>{selectedProduct.stablePrice} quote</em>
            <div className="wallet-node-status">
              <span>{routeStatus}</span>
              <span>{executionStatus}</span>
              <span>Settlement confirmed</span>
            </div>
          </div>
          <motion.div
            className="payment-line"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1 }}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="payment-card">
              <CircleDollarSign className="h-6 w-6 text-amber-200" />
              <span>Machine node reward</span>
              <strong>{selectedProduct.machineReward}</strong>
            </div>
            <div className="payment-card">
              <Gauge className="h-6 w-6 text-violet-200" />
              <span>Platform fee</span>
              <strong>{selectedProduct.platformFee}</strong>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Network fee</span>
              <strong className="font-mono text-sm text-amber-200">{selectedProduct.networkFee}</strong>
            </div>
            <div className="solana-fast-line" />
          </div>
        </div>
        <div className="confirmation-card">
          <CheckCircle2 className="h-9 w-9 text-amber-200" />
          <p className="mt-6 text-xs uppercase tracking-[0.24em] text-violet-200">Transaction confirmation</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Settlement complete</h3>
          <p className="mt-4 leading-7 text-slate-400">
            SOL transfer confirmed for {routedMachine.name}. Signature:
            <span className="mt-2 block font-mono text-xs text-violet-200">{selectedProduct.txHash}</span>
          </p>
          <div className="mt-6 space-y-2">
            {transactionFeed.map(([event, time], index) => (
              <motion.div
                key={event}
                className="tx-feed-row"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.14, duration: 0.35 }}
              >
                <span>{event}</span>
                <strong>{time}</strong>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <main className="workflow-os min-h-screen overflow-hidden bg-[#050712] text-slate-100">
      <MachineNetworkBackground />
      <div className="workflow-shell">
        <nav className="workflow-topbar">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <span className="block text-lg font-semibold tracking-wide text-white">Materialize</span>
              <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Production OS</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
              {wallet ? (
                <button type="button" className="nav-wallet connected" onClick={() => setWalletModalOpen(true)}>
                  <span className="wallet-status-dot" />
                  <WalletLogo wallet={wallet} className="nav-wallet-logo" />
                  <span>
                    <strong>{walletName}</strong>
                    <em>{walletAddress}</em>
                </span>
              </button>
            ) : (
              <button type="button" className="nav-wallet" onClick={() => setWalletModalOpen(true)}>
                <Wallet className="h-4 w-4" />
                Connect Wallet
              </button>
            )}
          </div>
        </nav>

        <div className="workflow-progress">
          <div className="workflow-progress-track">
            <motion.div className="workflow-progress-fill" animate={{ width: progressWidth }} transition={{ duration: 0.45, ease: 'easeOut' }} />
          </div>
          {journey.map(([id, label], index) => (
            <button
              key={id}
              ref={(element) => {
                stepRefs.current[index] = element
              }}
              type="button"
              className={`workflow-step ${index === activeStep ? 'active' : ''} ${index < activeStep ? 'complete' : ''}`}
              onClick={() => handleStepSelect(index)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {label}
            </button>
          ))}
        </div>

        <section className="workflow-stage">
          <div className="workflow-stage-header">
            <div>
              <p className="section-kicker">{slideHeader[activeJourney[0]][0]}</p>
              <h1 className="workflow-title">{slideHeader[activeJourney[0]][1]}</h1>
              <p className="section-copy">{slideHeader[activeJourney[0]][2]}</p>
            </div>
            <div className="wallet-pill">
              <span className={`wallet-status-dot ${wallet ? '' : 'idle'}`} />
              <Wallet className="h-4 w-4" />
              {walletName}
              <span>{walletAddress}</span>
              <span>{routeStatus}</span>
              <span>{executionStatus}</span>
            </div>
          </div>

          <div className="workflow-slide-wrap" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeJourney[0]}
                className="workflow-slide"
                initial={{ opacity: 0, x: 44, filter: 'blur(8px)' }}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, x: -44, filter: 'blur(8px)' }}
                transition={{ duration: 0.34, ease: 'easeOut' }}
              >
                {renderSlide()}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <div className="workflow-controls">
          <button type="button" className="workflow-control" onClick={goPrevious} disabled={activeStep === 0}>
            Previous
          </button>
          <div className="workflow-status">
            <span>{activeJourney[1]}</span>
            <strong>{String(activeStep + 1).padStart(2, '0')} / {String(journey.length).padStart(2, '0')}</strong>
          </div>
          <button
            type="button"
            className="workflow-control primary"
            onClick={handlePrimaryNext}
            disabled={activeStep === journey.length - 1 || generationState === 'generating'}
          >
            {activeJourney[0] === 'problem' && generationState === 'idle' ? 'Generate' : activeJourney[0] === 'problem' && generationState === 'generated' ? 'Route Job' : 'Next'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {walletModalOpen ? (
        <WalletModal
          onClose={() => setWalletModalOpen(false)}
          onSelect={(selectedWallet) => {
            setWallet(selectedWallet)
            setWalletModalOpen(false)
          }}
        />
      ) : null}
    </main>
  )
}

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const handleLocationChange = () => setPathname(window.location.pathname)

    window.addEventListener('popstate', handleLocationChange)
    return () => window.removeEventListener('popstate', handleLocationChange)
  }, [])

  if (pathname === '/launcher-demo') return <LauncherDemo />
  if (pathname === '/launcher-workshop') return <LauncherWorkshop />

  return <MaterializeApp />
}

export default App

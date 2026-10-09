import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileCheck2,
  Hammer,
  Link2,
  Loader2,
  RefreshCw,
  Router,
  ShieldCheck,
  Signal,
  WifiOff,
} from 'lucide-react'
import './App.css'

const LIVE_API_BASE_URL = import.meta.env.VITE_BADEM_API_URL || '/badem-api'

const DEMO_JOB = {
  id: 'BADEM-JOB-0042',
  request: '20 engraved wooden tags',
  material: 'plywood',
  process: 'laser engraving',
  machine: 'BADEM Node #001',
  controller: 'MKS DLC32 V2.1',
  fileSha256: '9aa5bc3d67891dcf797122cfa2fe9e4450f542e36faf630b5a5d79dd28fc4e08',
}

// Fallback values are intentionally isolated from API mapping code.
// They come from the Milestone 03A Devnet validation receipt and are only used
// when the API is unreachable, unconfigured, or ?mode=fallback is present.
const FALLBACK_DEMO_RECEIPT = {
  source: 'fallback-demo-data',
  nodeId: 'BADEM-001',
  jobId: 'BADEM-JOB-0042',
  validatedBackendJobId: '04cedb7c-2e0a-4ea7-b81f-75fb211510ee',
  proofId: 'bf2702dc-3e36-427a-9869-1271dbb7743c',
  proofHash: '9aa5bc3d67891dcf797122cfa2fe9e4450f542e36faf630b5a5d79dd28fc4e08',
  anchorHash: 'd77ed828f96f1627958232c525876a97f52636d7966a62f36d2238e93fdc7a85',
  transactionSignature: '5wrd2ktRb9hGEnt26fkfTZo9pgDhx17LgKRAZfBPz25AGG3kcLw6Xw3rjJniNHnGQpUsmys6Dauyu1KhBaKHMWZJ',
  cluster: 'devnet',
  anchoredAt: 1791484508,
  explorerUrl:
    'https://explorer.solana.com/tx/5wrd2ktRb9hGEnt26fkfTZo9pgDhx17LgKRAZfBPz25AGG3kcLw6Xw3rjJniNHnGQpUsmys6Dauyu1KhBaKHMWZJ?cluster=devnet',
}

const STATE_SEQUENCE = [
  { id: 'READY', label: 'READY', detail: 'Manufacturing request prepared', icon: FileCheck2 },
  { id: 'RUNNING', label: 'RUNNING', detail: 'BADEM Node is executing the job', icon: Activity },
  { id: 'COMPLETED', label: 'COMPLETED', detail: 'Physical machine run completed', icon: Hammer },
  { id: 'DEVICE_PROOF_VERIFIED', label: 'DEVICE PROOF VERIFIED', detail: 'Signed proof accepted by verifier', icon: ShieldCheck },
  { id: 'ANCHORED_ON_SOLANA', label: 'ANCHORED ON SOLANA', detail: 'Proof commitment finalized on Devnet', icon: Link2 },
]

const ARCHITECTURE = [
  { label: 'Machine', icon: Hammer },
  { label: 'BADEM Node', icon: Cpu },
  { label: 'Signed Proof', icon: BadgeCheck },
  { label: 'BADEM Verifier', icon: ShieldCheck },
  { label: 'Solana', icon: Link2 },
]

const API_STATUS_TO_STAGE = {
  CREATED: 'READY',
  RUNNING: 'RUNNING',
  AWAITING_BUYER: 'COMPLETED',
  PROOF_RECEIVED: 'DEVICE_PROOF_VERIFIED',
  PROOF_ANCHORED: 'ANCHORED_ON_SOLANA',
  FAILED: 'READY',
  ABORTED: 'READY',
}

function buildRuntimeConfig() {
  const params = new URLSearchParams(window.location.search)

  return {
    apiBaseUrl: (LIVE_API_BASE_URL || '').replace(/\/$/, ''),
    adminKey: import.meta.env.VITE_BADEM_ADMIN_KEY || '',
    jobId: params.get('job_id') || import.meta.env.VITE_BADEM_JOB_ID || '',
    proofId: params.get('proof_id') || import.meta.env.VITE_BADEM_PROOF_ID || '',
    nodeId: import.meta.env.VITE_BADEM_NODE_ID || '',
    proofHash: import.meta.env.VITE_BADEM_PROOF_HASH || '',
    forceFallback: params.get('mode') === 'fallback' || params.get('demo') === 'fallback',
  }
}

function stageIndex(stageId) {
  return Math.max(0, STATE_SEQUENCE.findIndex((stage) => stage.id === stageId))
}

function shorten(value, front = 8, back = 6) {
  if (!value) return 'Pending'
  if (value.length <= front + back + 3) return value
  return `${value.slice(0, front)}...${value.slice(-back)}`
}

function formatTimestamp(value) {
  if (!value) return 'Pending'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Pending'

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function explorerUrl(signature, cluster = 'devnet') {
  if (!signature) return ''
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`
}

function formatBackendStatus(status) {
  return status ? status.replaceAll('_', ' ') : 'Pending'
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2600)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim())
    }

    return response.json()
  } finally {
    window.clearTimeout(timer)
  }
}

function adminHeaders(adminKey) {
  return adminKey ? { 'X-Admin-Key': adminKey } : {}
}

function resolveStage(jobStatus, anchorStatus) {
  if (anchorStatus === 'ANCHORED') return 'ANCHORED_ON_SOLANA'
  return API_STATUS_TO_STAGE[jobStatus] || 'READY'
}

function buildFallbackState(reason = 'Using isolated fallback receipt') {
  return {
    source: 'fallback',
    sourceLabel: 'Fallback demo receipt',
    sourceDetail: reason,
    apiReachable: false,
    currentStage: 'ANCHORED_ON_SOLANA',
    job: DEMO_JOB,
    proof: {
      nodeId: FALLBACK_DEMO_RECEIPT.nodeId,
      jobId: FALLBACK_DEMO_RECEIPT.jobId,
      proofId: FALLBACK_DEMO_RECEIPT.proofId,
      proofHash: FALLBACK_DEMO_RECEIPT.proofHash,
      anchorHash: FALLBACK_DEMO_RECEIPT.anchorHash,
      transactionSignature: FALLBACK_DEMO_RECEIPT.transactionSignature,
      cluster: FALLBACK_DEMO_RECEIPT.cluster,
      anchoredAt: FALLBACK_DEMO_RECEIPT.anchoredAt,
      explorerUrl: FALLBACK_DEMO_RECEIPT.explorerUrl,
      status: 'ANCHORED',
    },
    backendStatus: 'PROOF_ANCHORED',
    events: [
      { event_type: 'STARTED', sequence: 1 },
      { event_type: 'FINISHED', sequence: 2 },
      { event_type: 'COMPLETED_PROOF', sequence: 3 },
    ],
  }
}

function normalizeApiState(payload, config, health) {
  const job = payload.job || {}
  const proof = payload.proof || {}
  const anchor = payload.anchor || {}
  const anchorStatus = anchor.status || (proof.proof_id ? 'NOT_ANCHORED' : 'WAITING_FOR_PROOF')
  const currentStage = resolveStage(job.status, anchorStatus)
  const txSignature = anchor.transaction_signature || ''
  const cluster = anchor.cluster || 'devnet'

  return {
    source: 'api',
    sourceLabel: 'Live FastAPI state',
    sourceDetail: health?.status === 'ok' ? 'Connected to BADEM API' : 'API response loaded',
    apiReachable: true,
    currentStage,
    job: {
      ...DEMO_JOB,
      id: job.id || config.jobId || DEMO_JOB.id,
      request: job.title || DEMO_JOB.request,
      machine: job.machine_id || DEMO_JOB.machine,
      fileSha256: job.file_sha256 || DEMO_JOB.fileSha256,
    },
    proof: {
      nodeId: proof.node_id || config.nodeId || job.machine_id || DEMO_JOB.machine,
      jobId: proof.job_id || job.id || config.jobId || DEMO_JOB.id,
      proofId: proof.proof_id || config.proofId || '',
      proofHash: proof.proof_hash || config.proofHash || job.file_sha256 || '',
      anchorHash: anchor.anchor_hash || '',
      transactionSignature: txSignature,
      cluster,
      anchoredAt: anchor.anchored_at || null,
      explorerUrl: anchor.explorer_url || explorerUrl(txSignature, cluster),
      status: anchorStatus,
    },
    backendStatus: job.status || 'API_CONNECTED',
    events: payload.events || [],
  }
}

async function loadLiveState(config) {
  if (config.forceFallback) {
    throw new Error('Fallback mode forced by URL')
  }

  if (!config.apiBaseUrl) {
    throw new Error('API base URL is not configured')
  }

  const health = await fetchJson(`${config.apiBaseUrl}/health`)

  if (!config.adminKey || !config.jobId) {
    throw new Error('API reachable; set VITE_BADEM_ADMIN_KEY and VITE_BADEM_JOB_ID for live job state')
  }

  try {
    const payload = await fetchJson(`${config.apiBaseUrl}/api/demo/jobs/${encodeURIComponent(config.jobId)}`, {
      headers: adminHeaders(config.adminKey),
    })
    return normalizeApiState(payload, config, health)
  } catch (error) {
    if (!config.proofId) throw error

    const jobPayload = await fetchJson(`${config.apiBaseUrl}/jobs/${encodeURIComponent(config.jobId)}`, {
      headers: adminHeaders(config.adminKey),
    })
    const anchorPayload = await fetchJson(
      `${config.apiBaseUrl}/api/proofs/${encodeURIComponent(config.proofId)}/anchor`,
      { headers: adminHeaders(config.adminKey) },
    )

    return normalizeApiState({
      job: jobPayload.job,
      events: jobPayload.events,
      proof: {
        proof_id: config.proofId,
        node_id: config.nodeId,
        job_id: config.jobId,
        proof_hash: config.proofHash,
      },
      anchor: anchorPayload,
    }, config, health)
  }
}

function BrandMark() {
  return (
    <span className="badem-mark" aria-hidden="true">
      <span />
      <strong>B</strong>
    </span>
  )
}

function SourcePill({ demoState, loading }) {
  const live = demoState.source === 'api'

  return (
    <div className={`source-pill ${live ? 'live' : 'fallback'}`}>
      {loading ? <Loader2 className="spin" /> : live ? <Signal /> : <WifiOff />}
      <span>
        <strong>{loading ? 'Checking API' : demoState.sourceLabel}</strong>
        <em>{demoState.sourceDetail}</em>
      </span>
    </div>
  )
}

function JobOverview({ demoState, currentIndex }) {
  const { job } = demoState

  return (
    <section className="job-overview panel">
      <div className="job-copy">
        <p className="kicker">Manufacturing request</p>
        <h1>BADEM-JOB-0042</h1>
        <p className="intro">
          One verified proof path for a physical laser job: request, node execution,
          signed completion proof, backend verification, and Devnet anchoring.
        </p>
      </div>

      <div className="job-visual">
        <img src="/demo-assets/badem-wooden-tags.png" alt="BADEM engraved wooden tags demo batch" />
        <div className="job-visual-badge">
          <CheckCircle2 />
          {STATE_SEQUENCE[currentIndex]?.label || 'READY'}
        </div>
      </div>

      <div className="job-spec-grid">
        <Spec label="Request" value={job.request} />
        <Spec label="Material" value={job.material} />
        <Spec label="Process" value={job.process} />
        <Spec label="Machine" value={job.machine} />
        <Spec label="Controller" value={job.controller} />
        <Spec label="Backend status" value={formatBackendStatus(demoState.backendStatus)} tone="strong" />
      </div>
    </section>
  )
}

function Spec({ label, value, tone = '' }) {
  return (
    <div className={`spec ${tone}`}>
      <span>{label}</span>
      <strong>{value || 'Pending'}</strong>
    </div>
  )
}

function StateProgress({ currentIndex }) {
  return (
    <section className="state-panel panel">
      <div className="section-heading">
        <p className="kicker">State progression</p>
        <h2>From ready job to Solana Proof of Production</h2>
      </div>

      <div className="state-list">
        {STATE_SEQUENCE.map((stage, index) => {
          const Icon = stage.icon
          const complete = index < currentIndex
          const active = index === currentIndex

          return (
            <div
              key={stage.id}
              className={`state-step ${complete ? 'complete' : ''} ${active ? 'active' : ''}`}
            >
              <span className="state-icon">
                {complete ? <CheckCircle2 /> : <Icon />}
              </span>
              <div>
                <strong>{stage.label}</strong>
                <em>{stage.detail}</em>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ArchitecturePanel() {
  return (
    <section className="architecture-panel panel">
      <div className="section-heading">
        <p className="kicker">Architecture</p>
        <h2>Machine -&gt; BADEM Node -&gt; Signed Proof -&gt; BADEM Verifier -&gt; Solana</h2>
      </div>

      <div className="architecture-chain">
        {ARCHITECTURE.map((item, index) => {
          const Icon = item.icon

          return (
            <div className="architecture-item" key={item.label}>
              <span>
                <Icon />
              </span>
              <strong>{item.label}</strong>
              {index < ARCHITECTURE.length - 1 ? <ArrowUpRight className="architecture-arrow" /> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ProofReceipt({ demoState }) {
  const { proof } = demoState
  const anchored = proof.status === 'ANCHORED'
  const rows = [
    ['Node ID', proof.nodeId],
    ['Job ID', proof.jobId],
    ['Proof hash', proof.proofHash],
    ['Anchor hash', proof.anchorHash],
    ['Solana transaction', shorten(proof.transactionSignature, 10, 8)],
    ['Cluster', proof.cluster ? proof.cluster[0].toUpperCase() + proof.cluster.slice(1) : 'Devnet'],
    ['Anchored timestamp', formatTimestamp(proof.anchoredAt)],
  ]

  return (
    <section className="receipt-panel panel">
      <div className="receipt-header">
        <div>
          <p className="kicker">Solana Proof of Production</p>
          <h2>{anchored ? 'Anchored proof receipt' : 'Proof receipt pending anchor'}</h2>
        </div>
        <div className={`receipt-status ${anchored ? 'anchored' : ''}`}>
          <Link2 />
          {proof.status || 'WAITING_FOR_PROOF'}
        </div>
      </div>

      <div className="receipt-grid">
        {rows.map(([label, value]) => (
          <div className="receipt-row" key={label}>
            <span>{label}</span>
            <strong>{value || 'Pending'}</strong>
          </div>
        ))}
      </div>

      <div className="receipt-actions">
        {proof.explorerUrl ? (
          <a href={proof.explorerUrl} target="_blank" rel="noreferrer">
            Open Solana Explorer
            <ExternalLink />
          </a>
        ) : (
          <span className="pending-link">Explorer link appears after anchoring</span>
        )}
      </div>
    </section>
  )
}

function BackendPanel({ demoState, loading, onRefresh }) {
  return (
    <section className="backend-panel panel">
      <div className="section-heading">
        <p className="kicker">API mode</p>
        <h2>{demoState.source === 'api' ? 'Displaying backend state' : 'Displaying isolated fallback data'}</h2>
      </div>

      <div className="backend-grid">
        <Spec label="Job endpoint" value={demoState.source === 'api' ? 'GET /api/demo/jobs/{job_id}' : 'Fallback disabled live reads'} />
        <Spec label="Anchor endpoint" value={demoState.proof.proofId ? 'GET /api/proofs/{proof_id}/anchor' : 'Waiting for proof ID'} />
        <Spec label="Events seen" value={String(demoState.events.length)} />
      </div>

      <button type="button" className="refresh-button" onClick={onRefresh} disabled={loading}>
        {loading ? <Loader2 className="spin" /> : <RefreshCw />}
        Refresh state
      </button>
    </section>
  )
}

function App() {
  const [config] = useState(buildRuntimeConfig)
  const [demoState, setDemoState] = useState(() => buildFallbackState('Checking API before using fallback'))
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const liveState = await loadLiveState(config)
      setDemoState(liveState)
    } catch (error) {
      setDemoState(buildFallbackState(error.message))
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    let cancelled = false

    loadLiveState(config)
      .then((liveState) => {
        if (!cancelled) setDemoState(liveState)
      })
      .catch((error) => {
        if (!cancelled) setDemoState(buildFallbackState(error.message))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [config])

  const currentIndex = stageIndex(demoState.currentStage)

  return (
    <main className="demo-shell">
      <header className="demo-topbar">
        <a className="brand" href="/" aria-label="BADEM demo home">
          <BrandMark />
          <span>
            <strong>BADEM</strong>
            <em>AI-Based DePIN Manufacturing</em>
          </span>
        </a>
        <SourcePill demoState={demoState} loading={loading} />
      </header>

      <div className="hero-grid">
        <JobOverview demoState={demoState} currentIndex={currentIndex} />
        <StateProgress currentIndex={currentIndex} />
      </div>

      <div className="detail-grid">
        <ArchitecturePanel />
        <ProofReceipt demoState={demoState} />
        <BackendPanel demoState={demoState} loading={loading} onRefresh={refresh} />
      </div>

      <footer className="demo-footer">
        <Router />
        <span>No wallet connection. No payments. No marketplace bidding. No machine control.</span>
      </footer>
    </main>
  )
}

export default App

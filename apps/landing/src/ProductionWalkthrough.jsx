import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUpRight, Box, Check, Cpu, Factory, Fingerprint, Image, Layers3, Play, RotateCcw, Server, ShieldCheck } from 'lucide-react'
import './ProductionWalkthrough.css'

// Recorded simulator validation, documented in solana/README.md (Milestone 03A).
const simulatorExplorerUrl = 'https://explorer.solana.com/tx/5wrd2ktRb9hGEnt26fkfTZo9pgDhx17LgKRAZfBPz25AGG3kcLw6Xw3rjJniNHnGQpUsmys6Dauyu1KhBaKHMWZJ?cluster=devnet'
const stages = ['READY', 'RUNNING', 'COMPLETED', 'PROOF VERIFIED', 'ANCHOR EXPLAINED']
const photos = {
  machine: {
    src: '/prototype/machine.jpeg', width: 2048, height: 1152,
    alt: 'Workshop laser prototype with an aluminum frame, wiring and controller setup',
    caption: 'Workshop prototype - machine assembly and controller setup.',
    detail: 'Laser machine prototype with a DLC32 / ESP32 reference integration.',
  },
  controller: {
    src: '/prototype/controller.jpeg', width: 1152, height: 2048,
    alt: 'Prototype controller housing beside the workshop laser machine',
    caption: 'MKS DLC32 V2.1 controller integration.',
    detail: 'MKS DLC32 V2.1 controller integration for the reference laser setup.',
  },
  enclosure: {
    src: '/prototype/enclosure.jpeg', width: 1152, height: 2048,
    alt: 'Open prototype enclosure with a controller board, wiring and screen',
    caption: 'Prototype enclosure development.',
    detail: 'An enclosure in development, not a validated BADEM Node device.',
  },
  output: {
    src: '/prototype/engraved-mark.png', width: 409, height: 474,
    alt: 'BADEM geometric mark laser-engraved on a plywood test piece',
    caption: 'Physical output from prototype testing.',
    detail: 'This photograph is not linked to a specific proof record.',
  },
}
const hardware = [
  { id: 'machine', label: 'Machine', Icon: Factory },
  { id: 'controller', label: 'Controller', Icon: Cpu },
  { id: 'enclosure', label: 'Enclosure', Icon: Box },
]
const actions = {
  READY: { label: 'Start demo job', Icon: Play, next: 'RUNNING' },
  RUNNING: { label: 'Complete job', Icon: Check, next: 'COMPLETED' },
  COMPLETED: { label: 'Verify device proof', Icon: ShieldCheck, next: 'PROOF VERIFIED' },
  'PROOF VERIFIED': { label: 'Explain Solana anchoring', Icon: Layers3, next: 'ANCHOR EXPLAINED' },
}
const descriptions = {
  READY: 'Start the walkthrough to explore the production-to-proof flow.',
  RUNNING: 'The machine executes the engraving job.',
  COMPLETED: 'In this walkthrough, the completion event is simulated.',
  'PROOF VERIFIED': 'In the implemented pipeline, the node signs the completion record and the backend checks its signature against the registered device identity.',
  'ANCHOR EXPLAINED': 'The backend anchors a hash of the verified record to Solana. The existing Devnet validation used a simulator-generated proof.',
}

export default function ProductionWalkthrough() {
  const [stage, setStage] = useState('READY')
  const [photoId, setPhotoId] = useState('machine')
  const [locked, setLocked] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const currentStage = useRef('READY')
  const actionLocked = useRef(false)
  const timer = useRef(null)
  const resetButton = useRef(null)
  const stageIndex = stages.indexOf(stage)
  const photo = photos[photoId]
  const action = actions[stage]
  const showVerification = verifying || stageIndex >= 3

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function reset() {
    window.clearTimeout(timer.current)
    timer.current = null
    actionLocked.current = false
    currentStage.current = 'READY'
    setStage('READY')
    setPhotoId('machine')
    setLocked(false)
    setVerifying(false)
  }

  function advance(event) {
    if (event.detail > 1 || actionLocked.current || currentStage.current !== stage || !action) return
    actionLocked.current = true
    setLocked(true)

    if (stage === 'COMPLETED') {
      setVerifying(true)
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      timer.current = window.setTimeout(() => {
        if (currentStage.current !== 'COMPLETED' || !actionLocked.current) return
        currentStage.current = 'PROOF VERIFIED'
        setStage('PROOF VERIFIED')
        setVerifying(false)
        setLocked(false)
        actionLocked.current = false
        timer.current = null
      }, reducedMotion ? 0 : 1100)
      return
    }

    currentStage.current = action.next
    setStage(action.next)
    if (stage === 'READY') setPhotoId('machine')
    if (stage === 'RUNNING') setPhotoId('output')
    if (action.next === 'ANCHOR EXPLAINED') {
      actionLocked.current = false
      setLocked(false)
      resetButton.current?.focus()
      return
    }

    // Briefly lock the changing action so a double click cannot advance two stages.
    timer.current = window.setTimeout(() => {
      actionLocked.current = false
      setLocked(false)
      timer.current = null
    }, 300)
  }

  return <section className="walkthrough" aria-labelledby="walkthrough-title">
    <div className="walkthrough-heading">
      <p className="walkthrough-label">Interactive walkthrough</p>
      <h3 id="walkthrough-title">From physical work to a verifiable record.</h3>
      <p className="walkthrough-note">Simulated controls · real prototype photos</p>
    </div>
    <div className="walkthrough-layout">
      <div className="walkthrough-media">
        <figure className="walkthrough-figure">
          <div className="walkthrough-photo">
            <img src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" />
            {stage === 'RUNNING' && photoId === 'machine' && <span className="walkthrough-activity"><Activity size={16} aria-hidden="true" />Simulated run</span>}
          </div>
          <figcaption>{photo.caption}</figcaption>
        </figure>
        <div className="walkthrough-hardware" role="group" aria-label="Hardware details">
          {hardware.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={photoId === id} aria-controls="walkthrough-photo-detail" onClick={() => setPhotoId(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}
        </div>
        <div id="walkthrough-photo-detail" className="walkthrough-photo-detail" aria-live="polite">
          <p>{photo.detail}</p>
          {stageIndex >= 2 && photoId !== 'output' && <button className="walkthrough-output-link" type="button" onClick={() => setPhotoId('output')}><Image size={16} aria-hidden="true" />View physical output</button>}
        </div>
      </div>
      <div className="walkthrough-panel">
        <p className="walkthrough-label">Manufacturing request</p>
        <h4>Engrave BADEM mark on plywood</h4>
        <dl className="walkthrough-job-details"><div><dt>Material</dt><dd>Plywood</dd></div><div><dt>Process</dt><dd>Laser engraving</dd></div></dl>
        <ol className="walkthrough-stages" aria-label="Walkthrough stages">
          {stages.map((label, index) => <li key={label} className={index < stageIndex ? 'done' : index === stageIndex ? 'current' : ''} aria-current={index === stageIndex ? 'step' : undefined}><span className="walkthrough-stage-marker" aria-hidden="true">{index < stageIndex ? <Check size={14} /> : index + 1}</span><span>{label}</span></li>)}
        </ol>
        <div className="walkthrough-status" role="status" aria-live="polite" aria-atomic="true">
          <span className="walkthrough-status-label">{verifying ? 'Illustrating verification' : stage}</span>
          <p>{descriptions[verifying ? 'PROOF VERIFIED' : stage]}</p>
        </div>
        {showVerification && <div className="walkthrough-verification">
          <p className="walkthrough-illustrative"><Fingerprint size={15} aria-hidden="true" />Illustrative verification</p>
          <div className={`walkthrough-transfer${verifying ? ' animating' : ''}`} aria-label="Illustration: BADEM Node to backend">
            <span><Cpu size={19} aria-hidden="true" />BADEM Node</span>
            <span className="walkthrough-transfer-line" aria-hidden="true"><Fingerprint size={17} /></span>
            <span><Server size={19} aria-hidden="true" />Backend</span>
          </div>
        </div>}
        {stage === 'ANCHOR EXPLAINED' && <div className="walkthrough-anchor">
          <p>No new transaction is created by this walkthrough.</p>
          <a href={simulatorExplorerUrl} target="_blank" rel="noreferrer">View simulator Devnet transaction <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>}
        <div className="walkthrough-actions">
          {action && <button className="button primary walkthrough-advance" type="button" onClick={advance} onKeyDown={event => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault() }} aria-disabled={locked} disabled={verifying}>{verifying ? <Fingerprint size={18} aria-hidden="true" /> : <action.Icon size={18} aria-hidden="true" />}{verifying ? 'Illustrating verification...' : action.label}</button>}
          <button ref={resetButton} className="walkthrough-reset" type="button" onClick={reset}><RotateCcw size={16} aria-hidden="true" />Reset walkthrough</button>
        </div>
      </div>
    </div>
  </section>
}

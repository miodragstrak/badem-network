import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowRight, ArrowUpRight, Box, Check, CircleDashed, Cpu, Factory, FileText, Fingerprint, Hash, Image, Layers3, Pause, Play, RotateCcw, Server, ShieldCheck, SkipForward } from 'lucide-react'
import './ProductionWalkthrough.css'

// Recorded simulator validation, documented in solana/README.md (Milestone 03A).
const simulatorExplorerUrl = 'https://explorer.solana.com/tx/5wrd2ktRb9hGEnt26fkfTZo9pgDhx17LgKRAZfBPz25AGG3kcLw6Xw3rjJniNHnGQpUsmys6Dauyu1KhBaKHMWZJ?cluster=devnet'
const stages = ['READY', 'RUNNING', 'COMPLETED', 'RECORD SIGNED', 'SIGNATURE VERIFIED', 'ANCHOR EXPLAINED']
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
  { id: 'output', label: 'Engraved output', Icon: Image },
]
const actions = {
  READY: { label: 'Start production', Icon: Play, next: 1 },
  COMPLETED: { label: 'Sign production record', Icon: Fingerprint, next: 3 },
  'RECORD SIGNED': { label: 'Verify signature', Icon: ShieldCheck, next: 4 },
  'SIGNATURE VERIFIED': { label: 'Explain Solana anchoring', Icon: Layers3, next: 5 },
}
const descriptions = {
  READY: 'A production job is ready for the machine.',
  RUNNING: 'The machine performs the engraving.',
  COMPLETED: "The node detects the machine's completion event.",
  'RECORD SIGNED': 'The node signs the completion record with its device key.',
  'SIGNATURE VERIFIED': 'The backend checks the signature and registered device identity.',
  'ANCHOR EXPLAINED': 'A hash of the signed record can be anchored to Solana.',
}
const initialFlow = { index: 0, epoch: 0, busy: false, videoStatus: 'idle' }
const readyScene = '/walkthrough/machine-ready.jpg'
const completedScene = '/walkthrough/machine-completed.jpg'
const motionQuery = '(prefers-reduced-motion: reduce)'
function subscribeMotion(callback) {
  const query = window.matchMedia(motionQuery)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
const getReducedMotion = () => window.matchMedia(motionQuery).matches

function ProductionConsole({ index, image, onImageError, onFinished }) {
  const checks = ['Registered device identity', 'Job association', 'Device signature']
  return <div className={`production-console console-step-${index}`} aria-label="BADEM Production Console, simulated">
    <header className="console-header">
      <div><p>BADEM Production Console</p><span>{index === 3 ? 'Device signing' : index === 4 ? 'Backend verification' : 'Solana anchor reference'}</span></div>
      <figure className="console-product">{image ? <img src={image} alt={image === completedScene ? 'Completed engraving in the AI-generated scene' : 'Ready-scene fallback, not completed output'} width="2728" height="1528" onError={onImageError} /> : <span>Scene unavailable</span>}<figcaption>AI-scene output</figcaption></figure>
    </header>
    <div className="console-workspace" onAnimationEnd={event => {
      // Only the final cue unlocks the action; earlier sequential cues may bubble here.
      if (event.target.dataset.consoleFinish === 'true') onFinished()
    }}>
      {index === 3 && <div className="console-signing">
        <div className="console-section-title"><Cpu size={20} aria-hidden="true" /><h5>BADEM Node · example identity</h5></div>
        <article className="console-record" aria-label="Illustrative production record">
          <div className="console-record-title"><FileText size={18} aria-hidden="true" /><strong>Production completion record</strong><Fingerprint className="console-signing-mark" size={22} aria-hidden="true" /></div>
          <dl>
            <div><dt>Job</dt><dd>BADEM engraving</dd></div>
            <div><dt>Node identity</dt><dd>BADEM-001 (example)</dd></div>
            <div><dt>Completion event</dt><dd>COMPLETED</dd></div>
            <div><dt>Device signature</dt><dd>Illustrative placeholder</dd></div>
          </dl>
        </article>
        <div className="console-signature-result" data-console-finish="true"><Fingerprint size={30} aria-hidden="true" /><div><strong>Simulated signature attached</strong><p>Device-key signing is illustrated, not performed.</p></div></div>
        <p className="console-footnote">The pictured enclosure is not a validated BADEM Node.</p>
      </div>}
      {index === 4 && <div className="console-verification">
        <div className="console-section-title"><Server size={20} aria-hidden="true" /><h5>Backend · illustrative checks</h5></div>
        <ol className="console-checks">{checks.map((label, index) => <li key={label} style={{ '--cue': index }}><Check size={19} aria-hidden="true" /><span>{label}</span><small>Illustrative</small></li>)}</ol>
        <p className="console-check-result" data-console-finish="true"><ShieldCheck size={19} aria-hidden="true" />Simulated checks complete. No verification was performed.</p>
        <p className="console-quality-limit">A device signature establishes the reported event's source and integrity, not physical output or product quality.</p>
      </div>}
      {index === 5 && <div className="console-anchoring">
        <div className="console-canonical">
          <h5><FileText size={17} aria-hidden="true" />Canonical signed record</h5>
          <code>BADEM_PROOF_ANCHOR_V1|node_id|job_id|event|timestamp|proof_hash|public_key|signature</code>
          <p><code>proof_hash</code> is the device-supplied evidence field inside this record.</p>
        </div>
        <div className="console-anchor-transfer">
          <div className="console-hash"><Hash size={20} aria-hidden="true" /><span><strong>SHA-256 → anchor_hash</strong><small>&lt;anchor hash&gt;</small></span></div>
          <ArrowRight className="console-send-arrow" size={23} aria-hidden="true" />
          <div className="console-solana"><Layers3 size={20} aria-hidden="true" /><span><strong>Solana Memo</strong><small>Only the anchor hash</small></span></div>
        </div>
        <div className="console-receipt" data-console-finish="true">
          <h5>Illustrative anchor receipt</h5>
          <dl><div><dt>Anchor hash</dt><dd>&lt;anchor hash&gt;</dd></div><div><dt>Transaction</dt><dd>Not created</dd></div><div><dt>Status</dt><dd>Simulated · not submitted</dd></div></dl>
        </div>
        <p className="console-offchain">The full record stays off-chain. Its hash provides a reference for checking whether the record has changed.</p>
      </div>}
    </div>
  </div>
}

export default function ProductionWalkthrough() {
  const [flow, setFlow] = useState(initialFlow)
  const [photoId, setPhotoId] = useState('output')
  const [failedScenes, setFailedScenes] = useState([])
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion, () => false)
  const flowRef = useRef(initialFlow)
  const videoRef = useRef(null)
  const playRequest = useRef(0)
  const wantsPlayback = useRef(false)
  const unlockTimer = useRef(null)
  const resetButton = useRef(null)
  const stage = stages[flow.index]
  const photo = photos[photoId]
  const action = actions[stage]
  const isPlaying = flow.videoStatus === 'playing'
  const isLoading = flow.videoStatus === 'loading'
  const videoFailed = flow.videoStatus === 'error'
  const sceneSource = flow.index < 2 ? readyScene : completedScene
  const sceneUnavailable = failedScenes.includes(sceneSource)
  const displayedScene = !sceneUnavailable ? sceneSource : !failedScenes.includes(readyScene) ? readyScene : null

  function updateFlow(patch) {
    flowRef.current = { ...flowRef.current, ...patch }
    setFlow(flowRef.current)
  }

  function isCurrentVideo(video, epoch) {
    return flowRef.current.index === 1 && flowRef.current.epoch === epoch && videoRef.current === video
  }

  function stopVideo(video) {
    playRequest.current += 1
    wantsPlayback.current = false
    if (!video) return
    video.pause()
    video.currentTime = 0
  }

  function playVideo(video, epoch) {
    if (!video || !isCurrentVideo(video, epoch) || flowRef.current.videoStatus === 'error') return
    const request = ++playRequest.current
    wantsPlayback.current = true
    updateFlow({ videoStatus: 'loading' })
    video.play().catch(() => {
      // A rejected play promise from a previous run must not affect a new one.
      if (request !== playRequest.current || !isCurrentVideo(video, epoch)) return
      wantsPlayback.current = false
      updateFlow({ videoStatus: 'blocked' })
    })
  }

  useEffect(() => {
    if (flow.index !== 1) return
    const video = videoRef.current
    if (!reducedMotion) playVideo(video, flow.epoch)
    return () => stopVideo(video)
    // Playback is tied to a run, never restarted by media status updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.index, flow.epoch, reducedMotion])

  useEffect(() => () => {
    window.clearTimeout(unlockTimer.current)
    playRequest.current += 1
  }, [])

  function unlock(epoch) {
    if (flowRef.current.epoch !== epoch) return
    window.clearTimeout(unlockTimer.current)
    updateFlow({ busy: false })
  }

  function moveTo(index) {
    window.clearTimeout(unlockTimer.current)
    const epoch = flowRef.current.epoch + 1
    updateFlow({ index, epoch, busy: true, videoStatus: 'idle' })
    if (index !== 1) stopVideo(videoRef.current)
    // This guards actions/animations only. Completion needs video ended or explicit skip.
    unlockTimer.current = window.setTimeout(() => unlock(epoch), index >= 3 && !reducedMotion ? index === 5 ? 2700 : 2100 : 350)
    if (index === 5) resetButton.current?.focus()
  }

  function reset() {
    window.clearTimeout(unlockTimer.current)
    updateFlow({ ...initialFlow, epoch: flowRef.current.epoch + 1 })
    stopVideo(videoRef.current)
    setFailedScenes([])
  }

  function advance(event) {
    if (event.detail > 1 || flowRef.current.busy || flowRef.current.epoch !== flow.epoch || !action) return
    moveTo(action.next)
  }

  function skip(event) {
    if (event.detail > 1 || flowRef.current.busy || flowRef.current.index !== 1 || flowRef.current.epoch !== flow.epoch) return
    moveTo(2)
  }

  function toggleVideo(event) {
    if (event.detail > 1 || flowRef.current.epoch !== flow.epoch) return
    const video = videoRef.current
    if (wantsPlayback.current) {
      playRequest.current += 1
      wantsPlayback.current = false
      video?.pause()
      updateFlow({ videoStatus: 'paused' })
    } else playVideo(video, flow.epoch)
  }

  function videoStatus(event, status) {
    if (!isCurrentVideo(event.currentTarget, flow.epoch) || flowRef.current.videoStatus === 'error') return
    if ((status === 'playing' || status === 'loading') && !wantsPlayback.current) return
    updateFlow({ videoStatus: status })
  }

  function videoError(event) {
    if (!isCurrentVideo(event.currentTarget, flow.epoch)) return
    stopVideo(event.currentTarget)
    updateFlow({ videoStatus: 'error' })
  }

  function videoEnded(event) {
    if (isCurrentVideo(event.currentTarget, flow.epoch) && event.currentTarget.ended && flowRef.current.videoStatus !== 'error') moveTo(2)
  }

  function preventRepeat(event) {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
  }

  const playbackNote = videoFailed ? 'Animation unavailable. Skip to the completion scene to continue.'
    : flow.videoStatus === 'blocked' ? 'Playback did not start. Play the animation or skip to completion.'
    : isLoading ? 'Loading animation. You can pause or skip.'
    : isPlaying ? 'Production animation playing.'
    : flow.videoStatus === 'paused' ? 'Production animation paused.'
    : 'Animation is paused. Play when ready, or skip to completion.'

  return <section className="walkthrough" aria-labelledby="walkthrough-title">
    <div className="walkthrough-heading">
      <div className="walkthrough-heading-top"><p className="walkthrough-label">Production → proof</p><span className="walkthrough-simulation-badge"><CircleDashed size={15} aria-hidden="true" />Simulation — no live transaction</span></div>
      <h3 id="walkthrough-title">See how production becomes a verifiable record.</h3>
      <p className="walkthrough-note">Interactive simulation · AI-generated machine scene</p>
    </div>
    <div className="walkthrough-layout">
      <div className="walkthrough-media">
        <figure className="walkthrough-figure">
          <div className="walkthrough-scene">
            {flow.index < 3 ? <>
              {displayedScene ? <img className="walkthrough-machine-image" src={displayedScene} alt={displayedScene === readyScene ? 'AI-generated laser machine scene with a blank plywood workpiece' : 'AI-generated laser machine scene after the illustrative engraving'} width="2728" height="1528" onError={() => setFailedScenes(previous => previous.includes(displayedScene) ? previous : [...previous, displayedScene])} /> : <p className="walkthrough-scene-fallback">Machine scene unavailable.</p>}
              {stage === 'RUNNING' && <video key={flow.epoch} ref={videoRef} src="/walkthrough/machine-production.mp4" poster={readyScene} muted playsInline preload="auto" aria-label="AI-generated engraving animation" hidden={videoFailed} onPlaying={event => videoStatus(event, 'playing')} onWaiting={event => videoStatus(event, 'loading')} onPause={event => videoStatus(event, 'paused')} onError={videoError} onEnded={videoEnded} />}
            </> : <ProductionConsole key={flow.epoch} index={flow.index} image={displayedScene} onImageError={() => setFailedScenes(previous => previous.includes(displayedScene) ? previous : [...previous, displayedScene])} onFinished={() => unlock(flow.epoch)} />}
          </div>
          <figcaption>{sceneUnavailable ? 'Requested scene unavailable; any displayed image is the ready scene, not completed output.' : 'Illustrative machine scene, not evidence of a physical production run.'}</figcaption>
        </figure>
      </div>
      <div className="walkthrough-panel">
        <p className="walkthrough-label">Illustrative job request</p>
        <h4>Engrave BADEM mark on plywood.</h4>
        <p className="walkthrough-job-note">Illustrative setup, not implemented remote job delivery.</p>
        <ol className="walkthrough-stages" aria-label="Walkthrough stages">
          {stages.map((label, index) => <li key={label} className={index < flow.index ? 'done' : index === flow.index ? 'current' : ''} aria-current={index === flow.index ? 'step' : undefined}><span className="walkthrough-stage-marker" aria-hidden="true">{index < flow.index ? <Check size={14} /> : index + 1}</span><span>{label}</span></li>)}
        </ol>
        <div className="walkthrough-status" role="status" aria-live="polite" aria-atomic="true">
          <span className="walkthrough-status-label">{stage}</span>
          <p>{descriptions[stage]}</p>
          {stage === 'RUNNING' && <p className="walkthrough-playback-note">{playbackNote}</p>}
          {stage === 'ANCHOR EXPLAINED' && <p className="walkthrough-complete">Walkthrough complete — no transaction was submitted.</p>}
        </div>
        <div className="walkthrough-actions">
          {action && <button className="button primary walkthrough-advance" type="button" onClick={advance} onKeyDown={preventRepeat} aria-disabled={flow.busy}><action.Icon size={18} aria-hidden="true" />{action.label}</button>}
          {stage === 'RUNNING' && <>
            {!videoFailed && <button className="button primary walkthrough-advance" type="button" onClick={toggleVideo} onKeyDown={preventRepeat}>{isPlaying || isLoading ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}{isPlaying || isLoading ? 'Pause animation' : flow.videoStatus === 'paused' ? 'Resume animation' : 'Play animation'}</button>}
            <button className={`walkthrough-skip${videoFailed ? ' button primary' : ''}`} type="button" onClick={skip} onKeyDown={preventRepeat} aria-disabled={flow.busy}><SkipForward size={17} aria-hidden="true" />Skip animation</button>
          </>}
          <button ref={resetButton} className="walkthrough-reset" type="button" onClick={reset} onKeyDown={preventRepeat}><RotateCcw size={16} aria-hidden="true" />Reset walkthrough</button>
        </div>
        <div className="walkthrough-evidence">
          {stage === 'ANCHOR EXPLAINED' && <div className="walkthrough-anchor"><a href={simulatorExplorerUrl} target="_blank" rel="noreferrer">View documented simulator transaction <ArrowUpRight size={16} aria-hidden="true" /></a><p>This separate Devnet transaction used a simulator-generated proof, not this AI scene.</p></div>}
          <p>Signing and verification here are illustrative. No device, backend or wallet is connected.</p>
          <p>The simulator proof pipeline was validated on Devnet; physical ESP32 end-to-end validation is still pending. Devnet can reset and is not a production permanence guarantee.</p>
        </div>
      </div>
    </div>
    <div className="walkthrough-hardware-reference" role="group" aria-label="Real prototype reference photos">
      <figure><div className="walkthrough-hardware-photo"><img src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" /></div><figcaption>{photo.caption}</figcaption></figure>
      <div><p className="walkthrough-label">Real prototype reference · separate from the AI scene</p>
        <div className="walkthrough-hardware" role="group" aria-label="Hardware details">{hardware.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={photoId === id} aria-controls="walkthrough-photo-detail" onClick={() => setPhotoId(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}</div>
        <p id="walkthrough-photo-detail" className="walkthrough-photo-detail" aria-live="polite">{photo.detail}</p>
      </div>
    </div>
  </section>
}

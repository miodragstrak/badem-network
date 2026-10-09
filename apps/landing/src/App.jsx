import { useState } from 'react'
import { ArrowUpRight, ArrowRight, Cpu, Fingerprint, ShieldCheck, Layers3, Menu, X, Check, Radio } from 'lucide-react'
import ProductionWalkthrough from './ProductionWalkthrough.jsx'

const repository = 'https://github.com/miodragstrak/badem-network'
const demoUrl = import.meta.env.VITE_DEMO_URL?.trim()
const steps = [
  ['01', 'Observe the controller', 'The DLC32 / ESP32 reference node is designed to observe controller status and associate events with a configured identity.'],
  ['02', 'Construct the record', 'A Run/Hold-to-Idle transition is treated as a completion event. Its metadata supplies the deterministic demo hash.'],
  ['03', 'Sign & verify', 'The signing component creates an Ed25519 record. Backend verification checks the registered identity and assigned job.'],
  ['04', 'Anchor the reference', 'The backend can anchor a verified record\'s hash on Solana Devnet. Raw telemetry remains off-chain.'],
]

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="header wrap">
      <a className="brand" href="#"><img src="/brand/badem-three-layer-lockup.png" alt="aiBADEM - Identity, Network, Manufacturing" width="1600" height="720" /></a>
      <button className="menu-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      <nav id="navigation" className={menuOpen ? 'nav open' : 'nav'} aria-label="Main navigation">
        <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
        <a href="#node" onClick={() => setMenuOpen(false)}>BADEM Node</a>
        <a href="#network" onClick={() => setMenuOpen(false)}>The network</a>
        <a className="nav-cta" href={repository} target="_blank" rel="noreferrer">Explore the code <ArrowUpRight size={16} /></a>
      </nav>
    </header>
    <main id="main">
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> AI-BASED DEPIN MANUFACTURING</p>
          <h1>Manufacturing,<br />connected.<br /><span>Production,<br />verifiable.</span></h1>
          <p className="intro">BADEM builds verifiable production records around a DLC32 / ESP32 reference integration.</p>
          <p className="hero-detail">Connect physical work to signed production records - building the foundation for an AI-powered manufacturing network.</p>
          <div className="actions"><a className="button primary" href={demoUrl || '#prototype'}>{demoUrl ? 'Explore the demo' : 'Explore the prototype'} <ArrowUpRight size={19} /></a><a className="text-link" href="#how-it-works">See how it works <ArrowRight size={18} /></a></div>
          <p className="hero-note">Built around existing equipment. Designed for verifiable work.</p>
        </div>
        <div className="hero-visual">
          <div className="visual-top"><span>THE PHYSICAL ↔ DIGITAL CONNECTION</span><span>BADEM / 001</span></div>
          <img src="/manufacturing-visual.png" alt="Visualization of laser-engraved wooden BADEM tags on a workshop table" width="1254" height="1254" fetchPriority="high" />
          <div className="visual-card"><div className="proof-icon"><Fingerprint size={28} /></div><div><span className="small-label">PRODUCTION RECORD</span><strong>Physical work. Digital provenance.</strong></div><ArrowUpRight size={21} /></div>
          <p className="image-caption">Manufacturing visualization · Explore the hardware prototype and proof workflow.</p>
        </div>
      </section>
      <div className="machine-strip"><div className="wrap"><span>CURRENT INTEGRATION</span><span>DLC32 / ESP32 laser</span><span>CNC integrations: roadmap</span><span>3D printer integrations: roadmap</span></div></div>
      <section className="section wrap problem">
        <p className="eyebrow">01 / THE OPPORTUNITY</p>
        <div className="split"><h2>Machines are everywhere.<br /><span>The connection is missing.</span></h2><div><p className="body-large">Workshops have the tools to make things. Buyers need a way to find the right capability - and credible evidence of what happened after a job was assigned.</p><p>BADEM starts at the machine: identity, activity and signed production records. That foundation makes a connected manufacturing network possible.</p></div></div>
      </section>
      <section id="how-it-works" className="flow-section"><div className="wrap section">
        <p className="eyebrow">02 / PROOF WORKFLOW ARCHITECTURE</p><h2>From controller status.<br />To a signed record.</h2>
        <p className="prototype-intro">The intended architecture connects machine events to verified records. Physical ESP32 end-to-end validation is still pending.</p>
        <div className="steps">{steps.map(([number, title, text]) => <article className="step" key={number}><span className="step-number">{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
        <div className="flow-footer"><ShieldCheck size={20} /><p>Machine telemetry stays off-chain. The verification reference is demonstrated on Solana Devnet.</p></div>
      </div></section>
      <section id="node" className="section wrap node-section">
        <div><p className="eyebrow">03 / BADEM NODE</p><h2>Your machine.<br /><span>A network identity.</span></h2><p className="body-large">An ESP32-based reference node for the MKS DLC32 V2.1 laser controller.</p><p>The reference implementation includes controller status observation, device identity and completion-record signing. Additional CNC and 3D printer integrations are part of the roadmap and depend on their interfaces.</p><ul className="feature-list"><li><Cpu size={20} />ESP32-based reference hardware</li><li><Radio size={20} />Machine status observation</li><li><Fingerprint size={20} />Ed25519 device signatures</li></ul></div>
        <div className="node-card" aria-label="Conceptual BADEM Node architecture"><div className="node-card-top"><span>REFERENCE IMPLEMENTATION</span><Cpu size={24} /></div><div className="chip"><span>BADEM</span><strong>NODE</strong><small>ESP32 / DEVICE IDENTITY</small></div><div className="node-ports"><span>Machine interface</span><span>Signed record</span><span>Network</span></div><p>Architecture illustration · Hardware prototype in development</p></div>
      </section>
      <section id="proof" className="proof-section"><div className="section wrap split">
        <div><p className="eyebrow">04 / PROOF OF PRODUCTION</p><h2>Evidence with<br />an identifiable source.</h2><p className="body-large">A production record is only useful when you can check where it came from and whether it changed.</p><a className="text-link" href={`${repository}/blob/main/docs/proof-of-production.md`} target="_blank" rel="noreferrer">Read the proof specification <ArrowUpRight size={18} /></a></div>
        <div className="proof-details"><article><Fingerprint /><div><h3>Device-signed</h3><p>A registered node signs the completion event with its own device key.</p></div></article><article><ShieldCheck /><div><h3>Backend-verified</h3><p>The backend checks the signature and associates the record with a known node and job.</p></div></article><article><Layers3 /><div><h3>Anchored to Solana Devnet</h3><p>A verification reference demonstrated on Solana Devnet. Raw telemetry remains off-chain.</p></div></article><p className="proof-limit">The proof establishes the source and integrity of the reported event. Physical output quality and customer acceptance require additional evidence.</p></div>
      </div></section>
      <section id="prototype" className="section wrap prototype">
        <div className="section-heading"><div><p className="eyebrow">05 / THE HACKATHON PROTOTYPE</p><h2>Start with one machine.<br /><span>Build the connection.</span></h2></div><span className="pill">Prototype / Solana Devnet</span></div>
        <p className="prototype-intro">Our hackathon focus is a laser machine connected through an MKS DLC32 V2.1 / ESP32 setup, device-signed completion records, backend verification and Solana Devnet anchoring.</p>
        <p className="prototype-intro"><strong>The proof pipeline has been validated with a simulator-generated record anchored to Solana Devnet.</strong> End-to-end validation with the physical ESP32 node is the next milestone.</p>
        <ProductionWalkthrough />
        <div className="prototype-gallery" role="group" aria-label="Hardware prototype development">
          <figure className="prototype-photo prototype-photo-main">
            <img src="/prototype/machine.jpeg" alt="Workshop laser machine prototype with an aluminum frame, wiring and controller displays" width="2048" height="1152" loading="lazy" />
            <figcaption>Workshop prototype - machine assembly and controller setup.</figcaption>
          </figure>
          <figure className="prototype-photo">
            <img src="/prototype/controller.jpeg" alt="Hand-held gray prototype housing beside the workshop machine during controller integration" width="1152" height="2048" loading="lazy" />
            <figcaption>MKS DLC32 V2.1 controller integration.</figcaption>
          </figure>
          <figure className="prototype-photo">
            <img src="/prototype/enclosure.jpeg" alt="Open prototype enclosure with a controller board, connected wiring and touchscreen" width="1152" height="2048" loading="lazy" />
            <figcaption>Prototype enclosure development.</figcaption>
          </figure>
        </div>
        <div className="prototype-grid"><div><h3>Implemented components</h3>{['Machine status detection', 'Deterministic proof hashing', 'Ed25519 device signing', 'Backend signature verification', 'Solana anchoring integration'].map(item => <p className="check-line" key={item}><Check size={18} />{item}</p>)}</div><div><h3>Next steps</h3><p>Customer acceptance, inbound job delivery, broader machine integrations and AI-based job structuring and routing.</p><p className="prototype-note">The current PoC focuses on the machine-to-proof path. The complete manufacturing marketplace is our next-stage vision.</p><div className="actions"><a className="text-link" href={repository} target="_blank" rel="noreferrer">Inspect the implementation <ArrowUpRight size={18} /></a>{demoUrl && <a className="button primary" href={demoUrl}>Open production demo <ArrowUpRight size={19} /></a>}</div></div></div>
      </section>
      <section id="network" className="network-section"><div className="section wrap">
        <p className="eyebrow">06 / THE NETWORK VISION</p><h2>From a production request<br />to the right machine.</h2><p className="network-intro">We are building toward a network where AI structures manufacturing requests, jobs reach compatible machines, and production records support trust between buyers and workshops.</p>
        <div className="vision-grid"><article><span>DEMAND</span><h3>Describe what you need.</h3><p>Buyers and applications submit requests that can become structured manufacturing jobs.</p></article><article><span>COORDINATION</span><h3>Find the capability.</h3><p>Planned AI-assisted routing matches jobs with machine capabilities, materials and availability.</p></article><article><span>PRODUCTION</span><h3>Make it. Record it.</h3><p>Connected workshops execute jobs and provide signed records, with customer acceptance as a further trust signal.</p></article></div>
        <p className="vision-caption">Roadmap vision · BADEM Node is the first reference implementation for a broader protocol.</p>
      </div></section>
      <section className="section wrap closing"><p className="eyebrow">BUILD WITH BADEM</p><h2>The next production network<br />starts with existing machines.</h2><p>Explore the prototype, inspect the code and help shape the protocol.</p><div className="actions"><a className="button primary" href={repository} target="_blank" rel="noreferrer">Explore on GitHub <ArrowUpRight size={19} /></a><a className="text-link" href="https://youtu.be/oN1Txge42qI" target="_blank" rel="noreferrer">Watch the early hardware update <ArrowUpRight size={18} /></a></div></section>
    </main>
    <footer className="wrap footer"><a className="brand" href="#"><img src="/brand/badem-three-layer-lockup.png" alt="aiBADEM - Identity, Network, Manufacturing" width="1600" height="720" /></a><span>AI-Based DePIN Manufacturing</span><span>Built for physical work.</span></footer>
  </>
}

import { ArrowRight, Factory, Fingerprint } from 'lucide-react'
import AppNavigation from './AppNavigation.jsx'
import { APP_PATHS } from './routes.js'
import './AppHome.css'

export default function AppHome({ notFound = false }) {
  return (
    <div className="app-home">
      <header className="app-home-header">
        <a className="brand" href={APP_PATHS.home} aria-label="BADEM home">
          <img
            src="/brand/badem-three-layer-lockup.png"
            alt="aiBADEM - Identity, Network, Manufacturing"
            width="1600"
            height="720"
          />
        </a>
        <AppNavigation current={notFound ? 'not-found' : 'home'} />
      </header>
      <main id="app-main" className="app-home-main" tabIndex="-1">
        <div className="app-home-intro">
          <p className="app-home-eyebrow">BADEM / Manufacturing Network</p>
          <h1>
            {notFound
              ? 'This page is not available.'
              : 'From manufacturing request to verifiable production.'}
          </h1>
          <p>
            {notFound
              ? 'Return to BADEM or explore Discovery and the Proof demo below.'
              : 'Describe what you need made, discover potential production partners, and see how BADEM connects physical production with verifiable records.'}
          </p>
        </div>
        <section className="app-products" aria-label="Explore BADEM">
          <article className="app-product" aria-labelledby="discovery-product">
            <div className="app-product-heading">
              <p className="app-home-eyebrow">01 / Discovery</p>
              <Factory aria-hidden="true" />
            </div>
            <h2 id="discovery-product">Find a production partner</h2>
            <p>
              Describe what you need. BADEM structures the request and discovers potential
              manufacturers using public production signals.
            </p>
            <a className="app-product-cta" href={APP_PATHS.discovery}>
              Start discovery <ArrowRight aria-hidden="true" />
            </a>
          </article>
          <article className="app-product app-product-proof" aria-labelledby="proof-product">
            <div className="app-product-heading">
              <p className="app-home-eyebrow">02 / Proof of Production</p>
              <Fingerprint aria-hidden="true" />
            </div>
            <h2 id="proof-product">See verified production</h2>
            <p>
              Follow a BADEM production record from machine execution to signed proof and Solana
              anchoring.
            </p>
            <div className="app-proof-entry">
              <a className="app-product-cta secondary" href={APP_PATHS.proof}>
                View Proof demo <ArrowRight aria-hidden="true" />
              </a>
              <img
                src="/demo-assets/badem-wooden-tags.png"
                alt="BADEM prototype mark engraved on plywood"
                width="409"
                height="474"
              />
            </div>
          </article>
        </section>
        <ol className="app-product-flow" aria-label="BADEM product flow">
          {['DISCOVER', 'QUALIFY', 'PRODUCE', 'PROVE'].map((step, index) => (
            <li key={step}>
              <span>{step}</span>
              {index < 3 && <ArrowRight aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}

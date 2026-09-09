import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import styles from "./launch-projection-details.module.css";

export function LaunchProjectionDetails({ projection }: { projection: LaunchProjectionV1 }) {
  const label = (value: string) => value.replaceAll("_", " ");
  return <section className={styles.details} aria-label="Launch provenance and distribution">
    <dl className={styles.states}>
      <div><dt>Programmable launch</dt><dd>{label(projection.finality.status)}</dd></div>
      <div><dt>Source verification</dt><dd>{label(projection.sourceVerification)}</dd></div>
      <div><dt>Programmable routing</dt><dd>{label(projection.distribution.programmableRouting)}</dd></div>
      <div><dt>Uniswap API</dt><dd>{label(projection.distribution.uniswapApi)}</dd></div>
      <div><dt>Uniswap Labs routing</dt><dd>{label(projection.distribution.uniswapLabsRouting)}</dd></div>
      <div><dt>Hooklist</dt><dd>{label(projection.distribution.hooklist)}</dd></div>
    </dl>
    <details><summary>Components, markets and assurance</summary>
      <p>{projection.components.length} {projection.components.length === 1 ? "component" : "components"} · {projection.markets.length} {projection.markets.length === 1 ? "market" : "markets"}</p>
      <ul>{projection.components.map(component => <li key={component.componentId}><span>{component.componentId}</span>
        <a href={`https://robinhoodchain.blockscout.com/address/${component.expectedAddress}`} target="_blank" rel="noreferrer"><code>{component.expectedAddress}</code><span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>
      {projection.markets.length ? <pre>{JSON.stringify(projection.markets, null, 2)}</pre> : <p>No market is declared in this launch.</p>}
      {projection.assuranceClaims.length ? <dl className={styles.claims}>{projection.assuranceClaims.map((claim, index) => <div key={`${claim.claimType}:${claim.subject}:${index}`}>
        <dt>{claim.claimType}</dt><dd>{label(claim.status)} · {typeof claim.observedValue === "string" ? claim.observedValue : JSON.stringify(claim.observedValue)}
          <small>Assessor: {claim.assessor} {claim.assessorVersion} · {claim.validAt}</small></dd></div>)}</dl> : <p>No additional assurance claims are attached.</p>}
      {projection.manifestDigest ? <p>Manifest: <code>{projection.manifestDigest}</code></p> : null}
    </details>
  </section>;
}

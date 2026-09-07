import { runEnginePublication } from "./main-engine";
import { readFile, mkdir, writeFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { moduleHash } from "../../lib/module-mode/release";
import { canonicalizeJson } from "../../lib/server/projection-target/canonical-json";
import { bindModuleModeCatalogFile, MODULE_MODE_CATALOG_SCHEMA, type ModuleModeCatalogDefinition, type ModuleModeHostReleaseIdentity } from "../../lib/server/module-mode/catalog";
import { createAuthenticatedReviewReader, exactJson, readOperatorSession, acceptedDecision, need, same } from "./review";
import { createHostPreparation, prepareModulePublication } from "./core";
import { publicationRpc, readPublicationOwner, observePublicationReadback, type PublicationProvider } from "./rpc";

interface Context { repositoryRoot: string; providers: () => Promise<(Omit<PublicationProvider, "rpc"> & { url: string })[]> }
export async function run(args: string[], context: Context) {
  const command = args.shift(); need(["manifest", "prepare", "export"].includes(command ?? ""), "Use manifest, prepare or export");
  const options: Record<string, string> = {};
  const required = ["identity", "definition", "submission", "session-file", "output", ...(command === "export" ? ["transactions"] : [])];
  const allowed = new Set([...required, "fee-eligibility"]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    need(args[i].startsWith("--") && allowed.has(key) && args[i + 1] && !Object.hasOwn(options, key), "Unexpected or duplicate publication option"); options[key] = args[i + 1];
  }
  need(required.every(key => Object.hasOwn(options, key)), "Missing publication options");
  const read = async (key: string, maximum = 2 * 1024 * 1024) => exactJson(await readFile(options[key]), maximum);
  const identity = await read("identity") as ModuleModeHostReleaseIdentity;
  const definition = await read("definition") as ModuleModeCatalogDefinition;
  const feeEligibility = options["fee-eligibility"] === undefined ? undefined : await read("fee-eligibility", 4096);
  const reader = createAuthenticatedReviewReader(await readOperatorSession(options["session-file"]));
  const review = await reader.read(options.submission);
  const output = path.resolve(options.output);
  const physicalParent = await realpath(path.dirname(output));
  const parentStat = await lstat(physicalParent);
  need(physicalParent === path.dirname(output) && parentStat.isDirectory() && parentStat.uid === process.getuid?.() && (parentStat.mode & 0o077) === 0, "Output parent must be a private owner-only real directory");
  need(!output.startsWith(path.resolve(context.repositoryRoot) + path.sep), "Write operator evidence outside the source checkout");
  if (review.artifact.schemaVersion === "programmable.modules.engine-build.v1") {
    need(feeEligibility === undefined, "Fee eligibility input is only supported by NativeV2 publication");
    return runEnginePublication({command:command!,identity,definition,review,reader,output,providers:context.providers,
      readTransactions:()=>read("transactions",16_384)});
  }
  const host = createHostPreparation(review, identity, definition, feeEligibility);
  let plan: ReturnType<typeof prepareModulePublication> | undefined;
  let evidence: Awaited<ReturnType<typeof observePublicationReadback>> | undefined;
  if (command !== "manifest") {
    acceptedDecision(review);
    const providers = (await context.providers()).map(({ url, ...binding }) => ({ ...binding, rpc: publicationRpc(url) }));
    const owner = await readPublicationOwner(host.release, providers);
    plan = prepareModulePublication(review, host.release, definition, owner, feeEligibility);
    if (command === "export") {
      const raw = await read("transactions", 16_384) as Record<string, unknown>;
      const v2 = identity.sourceVersion === "module-native-v2";
      need(raw && Object.keys(raw).sort().join(",") === (v2 ? "factory,family,feeEligibility,revision" : "factory,family,revision"), v2 ? "Expected factory, family, feeEligibility and revision transaction hashes" : "Expected factory, family and revision transaction hashes");
      const transactions = { factory: moduleHash(raw.factory, "factory.transaction"), family: raw.family === null ? null : moduleHash(raw.family, "family.transaction"), revision: moduleHash(raw.revision, "revision.transaction"),
        ...(v2 ? { feeEligibility: raw.feeEligibility === null ? null : moduleHash(raw.feeEligibility, "feeEligibility.transaction") } : {}) };
      evidence = await observePublicationReadback(plan, review, providers, transactions);
      const fresh = await reader.read(options.submission);
      same(prepareModulePublication(fresh, host.release, definition, owner, feeEligibility), plan, "Review changed during onchain readback");
    }
  }
  // No output exists until every requested read/validation has passed. Never overwrite a package or run.
  await mkdir(output, { mode: 0o700 });
  const write = (name: string, value: unknown) => writeFile(path.join(output, name), `${canonicalizeJson(value)}\n`, { flag: "wx", mode: 0o600 });
  if (command === "manifest") {
    await write("manifest.json", host.manifest); await write("host-preparation.json", host);
  } else {
    await write("unsigned-plan.json", plan);
    if (command === "export") {
      const packageId = plan!.publication.entry.nativeBinding.packageId;
      const directory = path.join(output, "public", "developers", "modules", packageId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, "source.json"), review.sourceBytes, { flag: "wx", mode: 0o600 });
      for (const [name, data] of [["manifest", plan!.manifest], ["review", plan!.publication.review]] as const) {
        await writeFile(path.join(directory, `${name}.json`), `${canonicalizeJson(data)}\n`, { flag: "wx", mode: 0o600 });
      }
      const catalog = bindModuleModeCatalogFile({ schemaVersion: MODULE_MODE_CATALOG_SCHEMA, sourceReleaseDigest: host.release.releaseDigest, entries: [plan!.publication] }, host.release);
      await write("catalog-fragment.json", catalog); await write("publication-evidence.json", evidence);
      await write("export.complete.json", { schemaVersion: "programmable.module-mode-publication-export.v1", status: "ready-for-protected-publication-review", packageId,
        releaseDigest: host.release.releaseDigest, reviewDigest: plan!.reviewDigest, planDigest: plan!.planDigest,
        websitePublished: false, ethereumFinalityProven: false });
    }
  }
  console.log(JSON.stringify({ status: command === "export" ? "ready-for-protected-publication-review" : command === "manifest" ? "review-required" : "unsigned-revalidation-required",
    output, packageId: host.nativeBinding.packageId, manifestHash: host.manifestHash, ...(plan ? { planDigest: plan.planDigest } : {}) }));
}

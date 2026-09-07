"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ModuleCategoryIcon } from "@/components/module-library";
import { ModuleDetailDialog } from "@/components/module-detail-dialog";
import { MODULE_CATEGORIES } from "@/lib/module-mode/library";
import { moduleDetailsForLaunch, readPublicModuleDetailsResponse, type ModuleLaunchDetailsBinding, type PublicModuleDetails } from "@/lib/module-mode/public-details";
import styles from "./token-launch-modules.module.css";

export function TokenLaunchModules({ launch }: { launch: ModuleLaunchDetailsBinding }) {
  const [response, setResponse] = useState<{ key: string; details: PublicModuleDetails | null } | null>(null);
  const packages = launch.modulePackageIds.join(",");
  const requestKey = `${launch.sourceKind ?? "native"}:${launch.sourceReleaseDigest}:${packages}`;
  useEffect(() => {
    if (!packages || ![undefined, "module-native-v1", "module-native-v2", "module-engine-v1"].includes(launch.sourceKind)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const query = new URLSearchParams({ packages, release: launch.sourceReleaseDigest });
    if (launch.sourceKind === "module-engine-v1") query.set("sourceKind", launch.sourceKind);
    void fetch(`/api/module-mode/details?${query}`, { signal: controller.signal, redirect: "error", headers: { accept: "application/json" } })
      .then(async result => result.ok && /^application\/json(?:\s*;|$)/i.test(result.headers.get("content-type") ?? "")
        ? readPublicModuleDetailsResponse(await result.json()) : null)
      .then(details => { if (!controller.signal.aborted) setResponse({ key: requestKey, details }); })
      .catch(() => { if (!controller.signal.aborted) setResponse({ key: requestKey, details: null }); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [packages, launch.sourceKind, launch.sourceReleaseDigest, requestKey]);
  return <TokenLaunchModulesView launch={launch} details={response?.key === requestKey ? response.details : null} />;
}

export function TokenLaunchModulesView({ launch, details }: { launch: ModuleLaunchDetailsBinding; details: PublicModuleDetails | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const items = moduleDetailsForLaunch(launch, details);
  const active = items.find(item => item.packageId === selected);
  return <section className={styles.section} aria-label="Attached modules">
    <h2>Modules {items.length ? <span>{items.length}</span> : null}</h2>
    {items.length ? <div className={styles.modules}>{items.map((item, index) => {
      const category = MODULE_CATEGORIES.find(category => category.id === item.details?.category.split("/")[0]);
      return <button className={styles.module} key={item.packageId} type="button" onClick={() => setSelected(item.packageId)} aria-haspopup="dialog">
        <ModuleCategoryIcon category={category?.id ?? "experiments"} size={20} /><span>{item.details?.title ?? `Module ${index + 1}`}</span><ChevronRight size={16} aria-hidden="true" />
      </button>;
    })}</div> : <p className={styles.empty}>No modules</p>}
    {active ? <ModuleDetailDialog module={active.details} packageId={active.packageId} familyId={active.familyId} title={`Module ${items.indexOf(active) + 1}`} onClose={() => setSelected(null)} /> : null}
  </section>;
}

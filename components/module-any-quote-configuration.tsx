"use client";

import { ArrowLeft } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { ModuleEngineAnyQuoteAsset, type AnyQuoteAssetAvailability } from "./module-engine-any-quote-asset";
import styles from "./module-any-quote-configuration.module.css";

export function ModuleAnyQuoteConfiguration({ value, onChange, availability, onBack, onRemove, disabled }: {
  value: string;
  onChange: (value: string) => void;
  availability: AnyQuoteAssetAvailability;
  onBack: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const input = panel.current?.querySelector<HTMLInputElement>("input");
    queueMicrotask(() => { if (input?.isConnected) input.focus({ preventScroll: true }); });
  }, []);
  return <div ref={panel} className={styles.panel}>
    <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to modules</button>
    <fieldset disabled={disabled} className={styles.fields}>
      <ModuleEngineAnyQuoteAsset inputId="module-picker-quote" value={value} onChange={onChange} availability={availability} />
    </fieldset>
    <button type="button" disabled={disabled} className={styles.remove} onClick={onRemove}>Remove module</button>
  </div>;
}

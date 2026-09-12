"use client";

import type { ModuleModeImageResource } from "@/components/module-mode-image";
import type { ModuleModeState } from "./builder";

export type ModuleModeLaunchDraftTarget = "native" | "any-quote";
export type ModuleModeLaunchDraftHandoff = Pick<ModuleModeState,
  "name" | "symbol" | "description" | "socialLinks" | "tokenImage" |
  "initialBuyEth" | "buyFeePercent" | "sellFeePercent"
> & {
  imageResource: ModuleModeImageResource | null;
  /** Retained for returning to native; its module selections do not apply to Any Quote. */
  nativeState?: ModuleModeState;
};

let pending: {
  target: ModuleModeLaunchDraftTarget;
  draft: Omit<ModuleModeLaunchDraftHandoff, "imageResource">;
  imageBlob: Blob | null;
} | null = null;

/** A route transition transfers only draft fields, never a prepared transaction or wallet state. */
export function saveModuleModeLaunchDraftHandoff(target: ModuleModeLaunchDraftTarget, draft: ModuleModeLaunchDraftHandoff): void {
  if (typeof window === "undefined") return;
  const { name, symbol, description, socialLinks, tokenImage, initialBuyEth, buyFeePercent, sellFeePercent, nativeState } = draft;
  pending = {
    target,
    draft: structuredClone({ name, symbol, description, socialLinks, tokenImage, initialBuyEth, buyFeePercent, sellFeePercent,
      ...(nativeState ? { nativeState } : {}) }),
    imageBlob: tokenImage.kind === "local" ? draft.imageResource?.blob ?? null : null,
  };
}

/** The destination owns the new object URL and revokes it through its usual image cleanup. */
export function consumeModuleModeLaunchDraftHandoff(target: ModuleModeLaunchDraftTarget): ModuleModeLaunchDraftHandoff | null {
  if (typeof window === "undefined" || !pending || pending.target !== target) return null;
  const { draft, imageBlob } = pending;
  const imageResource = imageBlob ? { blob: imageBlob, objectUrl: URL.createObjectURL(imageBlob) } : null;
  pending = null;
  return { ...draft, imageResource };
}

// Fixture-only control of the real route callbacks and native storage events.
// Nothing imports this file from the application.
import type { EffectCallback } from "react";

const deferredEntries = new Map<number, () => void>();
const deferredStorage: StorageEvent[] = [];
const receivedPreferences: (string | null)[] = [];
const deferredEffects = new Set<{ effect: EffectCallback; cleanup: ReturnType<EffectCallback> }>();
let nextTimer = -1;
const parameters = new URLSearchParams(location.search);
let holdEffects = parameters.get("holdViewChainEffect");
let holdEntries = parameters.has("holdRouteEntry") || holdEffects === "route";
let holdStorage = holdEntries || holdEffects === "provider";
const nativeCookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
let frozenCookie: string | null = null;
let blockPreferenceWrites = false;
const nativeSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key: string, value: string) {
  if (blockPreferenceWrites && key.startsWith("programmable:view-chain:")) throw new DOMException("Storage quota reached", "QuotaExceededError");
  nativeSetItem.call(this, key, value);
};
Object.defineProperty(document, "cookie", {
  configurable: true,
  get: () => frozenCookie ?? nativeCookie.get!.call(document),
  set: (value: string) => nativeCookie.set!.call(document, value),
});

export function deferViewChainEffect(effect: EffectCallback): ReturnType<EffectCallback> {
  const source = String(effect);
  const kind = source.includes("readViewChainRevision") ? "route" : source.includes("persistViewChain") ? "provider" : null;
  if (!kind || kind !== holdEffects) return effect();
  const deferred = { effect, cleanup: undefined as ReturnType<EffectCallback> };
  deferredEffects.add(deferred);
  return () => {
    deferredEffects.delete(deferred);
    deferred.cleanup?.();
  };
}

const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
Object.defineProperty(window, "setTimeout", { value: (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (holdEntries && delay === 0 && typeof callback === "function"
    && /\bsetViewChainId\d*\(/.test(String(callback))) {
    const id = nextTimer--;
    deferredEntries.set(id, () => callback(...args));
    return id;
  }
  return nativeSetTimeout(callback, delay, ...args);
} });
Object.defineProperty(window, "clearTimeout", { value: (id?: number) => {
  if (id !== undefined && deferredEntries.delete(id)) return;
  nativeClearTimeout(id);
} });

window.addEventListener("storage", (event) => {
  if (event.key === "programmable:view-chain:v2") receivedPreferences.push(event.newValue);
  if (!holdStorage || !event.key?.startsWith("programmable:view-chain:")) return;
  event.stopImmediatePropagation();
  deferredStorage.push(event);
}, true);

const scheduling = {
  freezeCookieReads: () => { frozenCookie = nativeCookie.get!.call(document); },
  releaseCookieReads: () => { frozenCookie = null; },
  receivedPreferences: () => [...receivedPreferences],
  blockPreferenceWrites: () => { blockPreferenceWrites = true; },
  pendingPassiveEffects: () => deferredEffects.size,
  releasePassiveEffects: () => {
    holdEffects = null;
    const effects = [...deferredEffects];
    deferredEffects.clear();
    for (const deferred of effects) deferred.cleanup = deferred.effect();
  },
  pendingEntries: () => deferredEntries.size,
  pendingStorageEvents: () => deferredStorage.length,
  releaseEntries: () => {
    holdEntries = false;
    const callbacks = [...deferredEntries.values()];
    deferredEntries.clear();
    for (const callback of callbacks) callback();
  },
  releaseStorageEvents: () => {
    holdStorage = false;
    for (const event of deferredStorage.splice(0)) {
      window.dispatchEvent(new StorageEvent("storage", {
        key: event.key, oldValue: event.oldValue, newValue: event.newValue,
        storageArea: event.storageArea, url: event.url,
      }));
    }
  },
};

declare global { interface Window { __viewChainScheduling: typeof scheduling } }
window.__viewChainScheduling = scheduling;

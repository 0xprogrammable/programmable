// Fixture-only control of the real route callbacks and native storage events.
// Nothing imports this file from the application.
export {};

const deferredEntries = new Map<number, () => void>();
const deferredStorage: StorageEvent[] = [];
let nextTimer = -1;
let holdEntries = new URLSearchParams(location.search).has("holdRouteEntry");
let holdStorage = holdEntries;

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
  if (!holdStorage || !event.key?.startsWith("programmable:view-chain:")) return;
  event.stopImmediatePropagation();
  deferredStorage.push(event);
}, true);

const scheduling = {
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

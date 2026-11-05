import { registerSW } from 'virtual:pwa-register';

let updateReady = false;
const listeners = new Set<() => void>();

const updateServiceWorker = registerSW({
  onNeedRefresh() {
    updateReady = true;
    listeners.forEach((listener) => listener());
  },
});

/** A new version waits for the learner's go-ahead, so an update never interrupts a session. */
export function onUpdateReady(listener: () => void): () => void {
  if (updateReady) listener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyUpdate(): void {
  void updateServiceWorker(true);
}

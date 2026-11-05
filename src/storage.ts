/** Asks the browser to protect local data. It may refuse silently, so backups stay the real safety net. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Unsupported or refused: backups still protect the data.
  }
}

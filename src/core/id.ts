/** A stable record id. Uses getRandomValues because randomUUID is missing outside secure contexts, such as a phone on the dev server. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const FNV_PRIME = 0x01000193;

function fnv1a(text: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Recognizes an import source seen before. SHA-256 where the browser allows it; the fallback only
 * runs outside secure contexts, where a rare collision would at worst reuse one source record.
 */
export async function hashText(text: string): Promise<string> {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return hex(new Uint8Array(digest));
  }
  return `fnv:${text.length}:${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01234567)}`;
}

/** The same for a file, so its identity comes from its content and never from its name. */
export async function hashBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (crypto.subtle) return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  // Only a phone on the dev server ever lands here.
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return `fnv:${bytes.length}:${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01234567)}`;
}

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Hex SHA-256; strings are hashed as UTF-8. In JS because `crypto.subtle` is missing on plain-HTTP pages (P-026). */
export function sha256Hex(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytesToHex(sha256(bytes));
}

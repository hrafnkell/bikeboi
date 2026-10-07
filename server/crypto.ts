// Secrets at rest (third-party API keys) are sealed with AES-256-GCM under SECRET_KEY.

const subtle = crypto.subtle;

/** A 32-byte key from the SECRET_KEY env var (hex or base64url); null when not configured. */
export async function loadSecretKey(value: string | undefined = process.env.SECRET_KEY): Promise<CryptoKey | null> {
  if (!value) return null;
  const raw = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
  if (raw.length !== 32) throw new Error('SECRET_KEY must be 32 bytes (64 hex characters)');
  const bytes = new Uint8Array(new ArrayBuffer(32));
  bytes.set(raw);
  return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** nonce (12 bytes) + ciphertext with tag. */
export async function seal(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const data = new TextEncoder().encode(plaintext);
  const box = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce);
  out.set(box, nonce.length);
  return out;
}

export async function open(key: CryptoKey, sealed: Uint8Array): Promise<string> {
  const nonce = new Uint8Array(new ArrayBuffer(12));
  nonce.set(sealed.subarray(0, 12));
  const box = new Uint8Array(new ArrayBuffer(sealed.length - 12));
  box.set(sealed.subarray(12));
  return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, box));
}

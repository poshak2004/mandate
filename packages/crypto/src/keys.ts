import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// @noble/ed25519 needs a synchronous SHA-512 for its sync API.
ed.etc.sha512Sync = (...messages) => sha512(ed.etc.concatBytes(...messages));

export interface KeyPair {
  /** 32-byte Ed25519 private key (seed), lowercase hex. Never log this. */
  privateKey: string;
  /** 32-byte Ed25519 public key, lowercase hex. */
  publicKey: string;
}

/** A signing key with the id stored next to each signature. */
export interface SigningKey {
  privateKey: string | Uint8Array;
  keyId: string;
}

/** Public keys by key id, as lowercase hex. */
export type PublicKeys = Record<string, string>;

export function toBytes(
  key: string | Uint8Array,
  expectedLength: number,
  what: string,
): Uint8Array {
  const bytes = typeof key === "string" ? hexToBytes(key) : key;
  if (bytes.length !== expectedLength) {
    throw new TypeError(`${what} must be ${expectedLength} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** Generates a fresh Ed25519 key pair from a CSPRNG. */
export function generateKeyPair(): KeyPair {
  const priv = ed.utils.randomPrivateKey();
  return { privateKey: bytesToHex(priv), publicKey: bytesToHex(ed.getPublicKey(priv)) };
}

/** Derives the public key for a private key. */
export function publicKeyOf(privateKey: string | Uint8Array): string {
  return bytesToHex(ed.getPublicKey(toBytes(privateKey, 32, "private key")));
}

export function sign(message: Uint8Array, privateKey: string | Uint8Array): string {
  return bytesToHex(ed.sign(message, toBytes(privateKey, 32, "private key")));
}

export function verify(
  signatureHex: string,
  message: Uint8Array,
  publicKey: string | Uint8Array,
): boolean {
  try {
    return ed.verify(
      toBytes(signatureHex, 64, "signature"),
      message,
      toBytes(publicKey, 32, "public key"),
    );
  } catch {
    return false;
  }
}

export { bytesToHex, hexToBytes };

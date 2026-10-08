import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { ReceiptBody } from "@mandate/schema";
import { canonicalize } from "./canonical";
import { sign, verify, type PublicKeys, type SigningKey } from "./keys";

/** prev_hash of the first receipt in every tenant's chain. */
export const GENESIS_PREV_HASH = "0".repeat(64);

const HEX64 = /^[0-9a-f]{64}$/;

/** A built receipt, before it is assigned a sequence number by the store. */
export interface BuiltReceipt {
  body: ReceiptBody;
  prev_hash: string;
  hash: string;
  signature: string;
  key_id: string;
}

/** A receipt as stored in a chain (what verifyChain consumes). */
export interface ChainReceipt extends BuiltReceipt {
  seq: number;
  id?: string;
  tenant_id?: string;
}

/** hash = SHA-256( prev_hash || canonical(body) ), as lowercase hex. */
export function hashReceipt(prevHash: string, body: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(prevHash + canonicalize(body))));
}

/**
 * Builds the next receipt in a chain: validates the body, hashes it onto prevHash and
 * signs the 32-byte hash with Ed25519.
 */
export function buildReceipt(
  prevHash: string,
  body: ReceiptBody,
  signingKey: SigningKey["privateKey"],
  keyId: string,
): BuiltReceipt {
  if (!HEX64.test(prevHash)) throw new TypeError("prevHash must be 64 lowercase hex characters");
  if (keyId.length === 0) throw new TypeError("keyId must not be empty");
  const parsed = ReceiptBody.parse(body);
  const hash = hashReceipt(prevHash, parsed);
  const signature = sign(hexToBytes(hash), signingKey);
  return { body: parsed, prev_hash: prevHash, hash, signature, key_id: keyId };
}

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; count: number; firstBrokenSeq: number | null; reason: string };

/**
 * Verifies one tenant's chain from genesis: sequence order, prev_hash links, hashes and
 * signatures. Reports the first receipt that fails.
 */
export function verifyChain(
  receipts: readonly ChainReceipt[],
  publicKeys: PublicKeys,
): ChainVerification {
  const count = receipts.length;
  const broken = (r: ChainReceipt | undefined, reason: string): ChainVerification => ({
    ok: false,
    count,
    firstBrokenSeq: typeof r?.seq === "number" ? r.seq : null,
    reason,
  });

  let prevHash = GENESIS_PREV_HASH;
  let prevSeq = -Infinity;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    try {
      if (typeof r !== "object" || r === null)
        return broken(undefined, `receipt #${i} is not an object`);
      if (!Number.isSafeInteger(r.seq) || r.seq <= prevSeq) {
        return broken(r, `seq ${String(r.seq)} is not greater than the previous seq ${prevSeq}`);
      }
      if (r.prev_hash !== prevHash) {
        return broken(
          r,
          i === 0
            ? "first receipt does not start from the genesis prev_hash"
            : "prev_hash does not match the previous receipt's hash (missing, reordered or altered receipt)",
        );
      }
      const expected = hashReceipt(r.prev_hash, r.body);
      if (r.hash !== expected)
        return broken(r, "hash does not match the receipt body (body was altered)");
      if (!Object.prototype.hasOwnProperty.call(publicKeys, r.key_id)) {
        return broken(r, `no public key for key_id ${String(r.key_id)}`);
      }
      const publicKey = publicKeys[r.key_id] as string;
      if (!verify(r.signature, hexToBytes(r.hash), publicKey)) {
        return broken(r, "signature is not valid for this hash and key");
      }
    } catch (err) {
      return broken(
        r,
        `receipt could not be verified: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    prevHash = r.hash;
    prevSeq = r.seq;
  }
  return { ok: true, count };
}

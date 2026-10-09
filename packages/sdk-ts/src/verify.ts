/**
 * Offline verification: check an exported receipt chain or a mandate token with nothing
 * but the signer's public key. No call to the Mandate API is needed.
 */
import { verifyChain, verifyMandateToken, type ChainReceipt } from "@mandate/crypto";
import type { ChainExport } from "./types";

/**
 * Verifies an export from /v1/receipts/export. Pass `trustedKeys` (key_id -> public key
 * hex) obtained out of band; by default the keys included in the export are used, which
 * proves integrity but not who signed.
 */
export function verifyExport(exported: ChainExport, trustedKeys?: Record<string, string>) {
  return verifyChain(exported.receipts as ChainReceipt[], trustedKeys ?? exported.public_keys);
}

/** Verifies a mandate JWS and returns the signed mandate (amounts in paise). */
export function verifyToken(jws: string, publicKeys: Record<string, string>) {
  return verifyMandateToken(jws, publicKeys);
}

/**
 * Regenerates fixtures/sample-chain.json and fixtures/sample-chain.pubkey.
 * The key is derived from a fixed public seed: it is a TEST KEY ONLY and signs nothing real.
 *
 *   pnpm --filter @mandate/crypto exec tsx scripts/make-fixture.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { ReceiptBody } from "@mandate/schema";
import { buildReceipt, GENESIS_PREV_HASH, publicKeyOf, type ChainReceipt } from "../src";

export const FIXTURE_PRIVATE_KEY = bytesToHex(
  sha256(utf8ToBytes("mandate fixture test key - not secret")),
);
export const FIXTURE_KEY_ID = "fixture-key-1";

const proposal = {
  agent_id: "marketplace-agent",
  principal_id: "seller_001",
  mandate_id: "mdt_fixture",
  commitment: {
    type: "accept_price",
    counterparty: "buyer_7731",
    reversible: false,
    amount_paise: 120000,
  },
  evidence: { offer_message_id: "msg_1" },
  dependencies: [],
  idempotency_key: "idem_fixture_1",
};

const bodies: ReceiptBody[] = [
  {
    decision: "BLOCK",
    rule_id: "LIMIT_PRICE_FLOOR",
    reason: "Rs 1,200 is below the price floor of Rs 1,500.",
  },
  {
    decision: "ESCALATE",
    rule_id: "APPROVAL_REQUIRED",
    reason: "The mandate requires approval for schedule_meeting.",
  },
  { decision: "ALLOW", rule_id: "WITHIN_MANDATE", reason: "accept_price is within mandate." },
].map((d, i) => ({
  kind: "decision" as const,
  proposal,
  mandate_ref: { id: "mdt_fixture", version: 1 },
  policy_version: 1,
  engine_version: "1.0.0",
  decision: d.decision as ReceiptBody["decision"],
  rule_id: d.rule_id,
  reason: d.reason,
  actor: "marketplace-agent",
  created_at: `2026-03-01T10:0${i}:00Z`,
}));
bodies.push({
  kind: "approval",
  proposal,
  mandate_ref: { id: "mdt_fixture", version: 1 },
  policy_version: 1,
  engine_version: "1.0.0",
  decision: "APPROVED",
  rule_id: "APPROVAL_REQUIRED",
  reason: "Seller approved the meeting.",
  actor: "seller_001",
  created_at: "2026-03-01T10:05:00Z",
});

export function makeFixtureChain(): ChainReceipt[] {
  let prev = GENESIS_PREV_HASH;
  return bodies.map((body, i) => {
    const r = buildReceipt(prev, body, FIXTURE_PRIVATE_KEY, FIXTURE_KEY_ID);
    prev = r.hash;
    return { seq: i + 1, ...r };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL("../fixtures/", import.meta.url);
  writeFileSync(
    new URL("sample-chain.json", dir),
    JSON.stringify(makeFixtureChain(), null, 2) + "\n",
  );
  writeFileSync(new URL("sample-chain.pubkey", dir), publicKeyOf(FIXTURE_PRIVATE_KEY) + "\n");
  console.log("wrote fixtures/sample-chain.json and fixtures/sample-chain.pubkey");
}

#!/usr/bin/env node
/**
 * pnpm verify:chain --file <receipts.json> --pubkey <hex> [--key-id <id>]
 *
 * Verifies a receipt chain file: a JSON array of receipts, or an object with a
 * `receipts` array. With --key-id, the public key applies to that key id only; without
 * it, the key is used for every key_id in the file. Exits 0 when the chain verifies.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyChain, type ChainReceipt } from "../receipt";

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

export function main(argv: string[]): number {
  let values: { file?: string; pubkey?: string; "key-id"?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv.filter((a) => a !== "--"),
      options: {
        file: { type: "string" },
        pubkey: { type: "string" },
        "key-id": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    fail(`verify:chain: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (values.help || !values.file || !values.pubkey) {
    fail(
      "usage: pnpm verify:chain --file <receipts.json> --pubkey <hex> [--key-id <id>]",
      values.help ? 0 : 2,
    );
  }
  const pubkey = values.pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) fail("verify:chain: --pubkey must be 64 hex characters");

  // pnpm runs scripts from the package root; resolve paths against where pnpm was invoked.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const path = resolve(baseDir, values.file);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`verify:chain: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const receipts = (Array.isArray(data) ? data : (data as { receipts?: unknown })?.receipts) as
    ChainReceipt[] | undefined;
  if (!Array.isArray(receipts))
    fail("verify:chain: file must contain an array of receipts or { receipts: [...] }");

  const keyIds = values["key-id"]
    ? [values["key-id"]]
    : [...new Set(receipts.map((r) => String(r?.key_id)))];
  const publicKeys = Object.fromEntries(keyIds.map((id) => [id, pubkey]));

  const result = verifyChain(receipts, publicKeys);
  if (result.ok) {
    console.log(`Chain verified: ${result.count} receipts`);
    return 0;
  }
  console.error(`Chain BROKEN at seq ${result.firstBrokenSeq ?? "?"}: ${result.reason}`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));

/**
 * Marketplace replay: an always-on consumer agent selling a keyboard for its owner,
 * replayed without and with Mandate.
 *
 *   pnpm --filter marketplace-replay start                 # with Mandate
 *   pnpm --filter marketplace-replay start -- --compare    # without, then with
 *   pnpm --filter marketplace-replay start -- --json       # also dump receipts.json
 *   pnpm --filter marketplace-replay start -- --pace 600   # pause 600ms per line (for recording)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { heading, renderEvent } from "./render";
import { replayWithMandate, replayWithoutMandate, type TimelineEvent } from "./scenario";

async function print(events: TimelineEvent[], pace: number): Promise<void> {
  for (const e of events) {
    for (const line of renderEvent(e)) console.log(line);
    if (pace > 0) await sleep(pace);
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    options: {
      compare: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      pace: { type: "string", default: "0" },
    },
  });
  const pace = Math.max(0, Number(values.pace) || 0);
  const start = new Date();

  console.log(pc.bold("\nMandate · marketplace replay"));
  console.log(
    pc.dim(
      "A 2026 incident: an always-on consumer agent managing a second-hand listing accepted a\n" +
        "lowball price, shared the seller's home address and arranged a pickup without asking.\n" +
        "Agent proposals are scripted. Decisions come from the deterministic engine; no LLM decides.",
    ),
  );

  if (values.compare) {
    console.log(heading("WITHOUT MANDATE", pc.red));
    await print(replayWithoutMandate(start), pace);
    console.log(
      `\n${pc.red(pc.bold("Result:"))} sold Rs 300 under the floor · home address disclosed · stranger coming to the house · seller asked: never`,
    );
  }

  console.log(heading("WITH MANDATE", pc.green));
  const replay = await replayWithMandate(start);
  await print(replay.events, pace);
  console.log(
    `\n${pc.green(pc.bold("Result:"))} sold at Rs 1,600 (above the Rs 1,500 floor) · no PII disclosed · public meetup approved by the seller`,
  );

  if (!replay.verification.ok) {
    console.error(pc.red(`\nChain verification FAILED: ${replay.verification.reason}`));
    return 1;
  }
  console.log(pc.bold(pc.green(`\nChain verified: ${replay.verification.count} receipts`)));
  console.log(pc.dim(`Signing public key (Ed25519): ${replay.publicKey}`));

  if (values.json) {
    // pnpm runs scripts in the package directory; write next to where pnpm was invoked.
    const out = resolve(process.env.INIT_CWD ?? process.cwd(), "receipts.json");
    writeFileSync(out, JSON.stringify(replay.receipts, null, 2) + "\n");
    console.log(pc.dim(`Receipts written to ${out}`));
    console.log(
      pc.dim(`Verify: pnpm verify:chain --file receipts.json --pubkey ${replay.publicKey}`),
    );
  }
  console.log("");
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);

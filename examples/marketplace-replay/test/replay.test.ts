import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyChain } from "@mandate/crypto";
import { replayWithMandate, replayWithoutMandate, KEY_ID } from "../src/scenario";
import { renderEvent, truncateToken } from "../src/render";

const START = new Date("2026-03-14T10:00:00Z");

describe("replay with Mandate", () => {
  it("produces the scripted decisions in order", async () => {
    const replay = await replayWithMandate(START);
    const decisions = replay.events.flatMap((e) =>
      e.kind === "decision" ? [`${e.decision.decision} ${e.decision.rule_id}`] : [],
    );
    expect(decisions).toEqual([
      "BLOCK LIMIT_PRICE_FLOOR",
      "BLOCK LIMIT_PII",
      "ALLOW WITHIN_MANDATE",
      "ESCALATE APPROVAL_REQUIRED",
      "ALLOW WITHIN_MANDATE",
    ]);
    expect(replay.events.filter((e) => e.kind === "approval")).toHaveLength(1);
  });

  it("writes a verifiable chain of decision and approval receipts", async () => {
    const replay = await replayWithMandate(START);
    expect(replay.receipts.map((r) => r.body.kind)).toEqual([
      "decision",
      "decision",
      "decision",
      "decision",
      "approval",
      "decision",
    ]);
    expect(replay.verification).toEqual({ ok: true, count: 6 });
    expect(verifyChain(replay.receipts, { [KEY_ID]: replay.publicKey }).ok).toBe(true);
  });

  it("renders every event and never prints a full token", async () => {
    const replay = await replayWithMandate(START);
    const mandateEvent = replay.events.find((e) => e.kind === "mandate");
    const text = replay.events.flatMap(renderEvent).join("\n");
    expect(mandateEvent && text.includes(mandateEvent.token)).toBe(false);
    expect(text).toContain("LIMIT_PRICE_FLOOR");
    expect(truncateToken("a".repeat(100))).toContain("(100 chars)");
  });
});

describe("replay without Mandate", () => {
  it("shows all three harms", () => {
    const harms = replayWithoutMandate(START).flatMap((e) =>
      e.kind === "agent-action" ? [e.harm] : [],
    );
    expect(harms).toHaveLength(3);
    expect(replayWithoutMandate(START).flatMap(renderEvent).join("\n")).toContain("home address");
  });
});

describe("CLI", () => {
  it("runs --compare --json end to end and the dumped receipts verify", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "mandate-replay-"));
    const tsx = join(root, "node_modules/.bin/tsx");
    const out = execFileSync(
      tsx,
      [fileURLToPath(new URL("../src/index.ts", import.meta.url)), "--compare", "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, INIT_CWD: dir, NO_COLOR: "1" },
      },
    );
    expect(out).toContain("WITHOUT MANDATE");
    expect(out).toContain("WITH MANDATE");
    expect(out).toContain("Chain verified: 6 receipts");
    expect(out).not.toMatch(/company|facebook|meta/i);
    const pubkey = /--pubkey ([0-9a-f]{64})/.exec(out)?.[1];
    expect(pubkey).toBeDefined();
    const receipts = JSON.parse(readFileSync(join(dir, "receipts.json"), "utf8"));
    expect(verifyChain(receipts, { [KEY_ID]: pubkey! })).toEqual({ ok: true, count: 6 });
  }, 60_000);
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SignedReceipt, type Mandate, type ReceiptBody } from "@mandate/schema";
import {
  buildReceipt,
  canonicalize,
  GENESIS_PREV_HASH,
  generateKeyPair,
  hashReceipt,
  issueMandateToken,
  MandateTokenError,
  publicKeyOf,
  verifyChain,
  verifyMandateToken,
  type ChainReceipt,
} from "../src";

describe("canonicalize (RFC 8785)", () => {
  it("sorts keys and removes whitespace", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    );
  });
  it("serialises numbers like ECMAScript (RFC 8785 appendix B samples)", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [-0, "0"],
      [1, "1"],
      [4.5, "4.5"],
      [0.002, "0.002"],
      [1e-7, "1e-7"],
      [1e21, "1e+21"],
      [1e30, "1e+30"],
      [333333333.3333333, "333333333.3333333"],
      [9007199254740991, "9007199254740991"],
      [-1.5e-9, "-1.5e-9"],
    ];
    for (const [n, s] of cases) expect(canonicalize(n)).toBe(s);
  });
  it("matches the RFC 8785 example object", () => {
    const input = {
      // The RFC's own literal; the precision loss is the point of the test.
      // eslint-disable-next-line no-loss-of-precision
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: "\u20ac$\u000f\u000aA'\u0042\u0022\u005c\\\"/",
      literals: [null, true, false],
    };
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });
  it("sorts keys by UTF-16 code units", () => {
    const input = {
      "\u20ac": 1,
      "\r": 2,
      "\ufb33": 3,
      "1": 4,
      "\ud83d\ude00": 5,
      "\u0080": 6,
      "\u00f6": 7,
    };
    // RFC 8785 section 3.2.3 ordering: \r, 1, U+0080, U+00F6, U+20AC, U+1F600 (surrogates), U+FB33.
    expect(canonicalize(input)).toBe(
      '{"\\r":2,"1":4,"\u0080":6,"\u00f6":7,"\u20ac":1,"\ud83d\ude00":5,"\ufb33":3}',
    );
  });
  it("omits undefined members but rejects unrepresentable values", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize([undefined])).toThrow();
    expect(() => canonicalize(undefined)).toThrow();
    expect(() => canonicalize(() => 1)).toThrow();
    expect(() => canonicalize(10n)).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(/cyclic/);
  });
  it("allows the same object twice when it is not a cycle", () => {
    const shared = { x: 1 };
    expect(canonicalize([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });
});

const keys = generateKeyPair();
const KEY_ID = "k1";
const publicKeys = { [KEY_ID]: keys.publicKey };

function body(i: number, overrides: Partial<ReceiptBody> = {}): ReceiptBody {
  return {
    kind: "decision",
    proposal: { idempotency_key: `idem_${i}`, amount_paise: 1000 + i },
    mandate_ref: { id: "mdt_1", version: 1 },
    policy_version: 1,
    engine_version: "1.0.0",
    decision: "ALLOW",
    rule_id: "WITHIN_MANDATE",
    reason: `receipt ${i}`,
    actor: "agent_a",
    created_at: "2026-03-01T10:00:00Z",
    ...overrides,
  } as ReceiptBody;
}

function chain(n: number, privateKey = keys.privateKey, keyId = KEY_ID): ChainReceipt[] {
  const out: ChainReceipt[] = [];
  let prev = GENESIS_PREV_HASH;
  for (let i = 0; i < n; i++) {
    const r = buildReceipt(prev, body(i), privateKey, keyId);
    out.push({ seq: i + 1, ...r });
    prev = r.hash;
  }
  return out;
}

const clone = <T>(x: T): T => structuredClone(x);

describe("keys", () => {
  it("generates distinct 32-byte key pairs", () => {
    const other = generateKeyPair();
    expect(keys.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(other.privateKey).not.toBe(keys.privateKey);
    expect(publicKeyOf(keys.privateKey)).toBe(keys.publicKey);
  });
});

describe("buildReceipt", () => {
  it("hashes prev_hash || canonical(body) and signs the hash", () => {
    const r = buildReceipt(GENESIS_PREV_HASH, body(0), keys.privateKey, KEY_ID);
    expect(r.prev_hash).toBe("0".repeat(64));
    expect(r.hash).toBe(hashReceipt(GENESIS_PREV_HASH, body(0)));
    expect(r.key_id).toBe(KEY_ID);
    expect(SignedReceipt.safeParse({ seq: 1, ...r }).success).toBe(true);
  });
  it("is independent of key order in the body", () => {
    const reversed = Object.fromEntries(Object.entries(body(0)).reverse()) as ReceiptBody;
    expect(buildReceipt(GENESIS_PREV_HASH, reversed, keys.privateKey, KEY_ID).hash).toBe(
      buildReceipt(GENESIS_PREV_HASH, body(0), keys.privateKey, KEY_ID).hash,
    );
  });
  it("rejects invalid bodies, prev hashes, keys and key ids", () => {
    expect(() =>
      buildReceipt(
        GENESIS_PREV_HASH,
        { ...body(0), decision: "APPROVED" },
        keys.privateKey,
        KEY_ID,
      ),
    ).toThrow();
    expect(() => buildReceipt("abc", body(0), keys.privateKey, KEY_ID)).toThrow(/prevHash/);
    expect(() => buildReceipt(GENESIS_PREV_HASH, body(0), "abcd", KEY_ID)).toThrow(/32 bytes/);
    expect(() => buildReceipt(GENESIS_PREV_HASH, body(0), keys.privateKey, "")).toThrow(/keyId/);
  });
});

describe("verifyChain", () => {
  it("verifies a valid chain of 1,000 receipts", () => {
    const c = chain(1000);
    expect(verifyChain(c, publicKeys)).toEqual({ ok: true, count: 1000 });
  }, 60_000);

  it("verifies an empty chain", () => {
    expect(verifyChain([], publicKeys)).toEqual({ ok: true, count: 0 });
  });

  const base = chain(6);

  it.each([
    ["kind", { kind: "approval", decision: "APPROVED" }],
    ["proposal", { proposal: { idempotency_key: "idem_2", amount_paise: 1 } }],
    ["mandate_ref", { mandate_ref: { id: "mdt_1", version: 2 } }],
    ["policy_version", { policy_version: 2 }],
    ["engine_version", { engine_version: "9.9.9" }],
    ["decision", { decision: "BLOCK" }],
    ["rule_id", { rule_id: "LIMIT_PII" }],
    ["reason", { reason: "edited" }],
    ["actor", { actor: "someone_else" }],
    ["created_at", { created_at: "2026-03-01T10:00:01Z" }],
  ])("fails when body.%s is tampered with", (_field, change) => {
    const c = clone(base);
    c[2]!.body = { ...c[2]!.body, ...change } as ReceiptBody;
    const result = verifyChain(c, publicKeys);
    expect(result).toMatchObject({ ok: false, firstBrokenSeq: 3 });
    if (!result.ok) expect(result.reason).toMatch(/hash/);
  });

  it("fails when a tampered body is re-hashed but not re-signed", () => {
    const c = clone(base);
    c[2]!.body = { ...c[2]!.body, reason: "edited" };
    c[2]!.hash = hashReceipt(c[2]!.prev_hash, c[2]!.body);
    // The signature no longer matches, and the next link breaks too; the first failure is reported.
    expect(verifyChain(c, publicKeys)).toMatchObject({
      ok: false,
      firstBrokenSeq: 3,
      reason: expect.stringMatching(/signature/),
    });
  });

  it("fails when receipts are reordered", () => {
    const c = clone(base);
    [c[2], c[3]] = [c[3]!, c[2]!];
    expect(verifyChain(c, publicKeys)).toMatchObject({ ok: false, firstBrokenSeq: 4 });
    const renumbered = clone(c).map((r, i) => ({ ...r, seq: i + 1 }));
    expect(verifyChain(renumbered, publicKeys)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it("fails when a receipt is deleted", () => {
    const middle = clone(base);
    middle.splice(3, 1);
    expect(verifyChain(middle, publicKeys)).toMatchObject({
      ok: false,
      firstBrokenSeq: 5,
      reason: expect.stringMatching(/prev_hash/),
    });
    const first = clone(base).slice(1);
    expect(verifyChain(first, publicKeys)).toMatchObject({
      ok: false,
      firstBrokenSeq: 2,
      reason: expect.stringMatching(/genesis/),
    });
  });

  it("fails when signatures are swapped", () => {
    const c = clone(base);
    [c[1]!.signature, c[2]!.signature] = [c[2]!.signature, c[1]!.signature];
    expect(verifyChain(c, publicKeys)).toMatchObject({
      ok: false,
      firstBrokenSeq: 2,
      reason: expect.stringMatching(/signature/),
    });
  });

  it("fails with the wrong or an unknown key", () => {
    expect(verifyChain(base, { [KEY_ID]: generateKeyPair().publicKey })).toMatchObject({
      ok: false,
      firstBrokenSeq: 1,
    });
    expect(verifyChain(base, {})).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no public key/),
    });
  });

  it("fails on duplicate or decreasing seq and on malformed receipts", () => {
    const c = clone(base);
    c[1]!.seq = 1;
    expect(verifyChain(c, publicKeys)).toMatchObject({
      ok: false,
      firstBrokenSeq: 1,
      reason: expect.stringMatching(/seq/),
    });
    expect(verifyChain([null as unknown as ChainReceipt], publicKeys)).toMatchObject({
      ok: false,
      firstBrokenSeq: null,
    });
    const bad = clone(base);
    (bad[0]!.body as unknown as Record<string, unknown>).reason = Number.NaN;
    expect(verifyChain(bad, publicKeys)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/could not be verified/),
    });
    const badSig = clone(base);
    badSig[0]!.signature = "zz";
    expect(verifyChain(badSig, publicKeys)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/signature/),
    });
  });

  it("supports key rotation via key_id", () => {
    const k2 = generateKeyPair();
    const first = chain(2);
    const next = buildReceipt(first[1]!.hash, body(2), k2.privateKey, "k2");
    const c = [...first, { seq: 3, ...next }];
    expect(verifyChain(c, { [KEY_ID]: keys.publicKey, k2: k2.publicKey })).toEqual({
      ok: true,
      count: 3,
    });
  });
});

describe("mandate tokens (JWS EdDSA)", () => {
  const mandate: Mandate = {
    id: "mdt_1",
    principal: "seller_001",
    agent: "marketplace-agent",
    scope: ["accept_price"],
    limits: { accept_price: { min_paise: 150000 } },
    requires_approval: [],
    expires_at: "2026-12-31T23:59:59Z",
    revoked: false,
    version: 1,
  };
  const key = { privateKey: keys.privateKey, keyId: KEY_ID };

  it("round-trips a mandate", async () => {
    const token = await issueMandateToken(mandate, key);
    expect(token.split(".")).toHaveLength(3);
    const header = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
    expect(header).toEqual({ alg: "EdDSA", kid: KEY_ID, typ: "mandate+jws" });
    const payload = Buffer.from(token.split(".")[1]!, "base64url").toString();
    expect(payload).toBe(canonicalize(mandate));
    await expect(verifyMandateToken(token, publicKeys)).resolves.toEqual({
      mandate,
      keyId: KEY_ID,
    });
  });

  it("refuses to issue an invalid mandate", async () => {
    await expect(issueMandateToken({ ...mandate, version: 0 }, key)).rejects.toThrow();
  });

  it("rejects tampered payloads, wrong keys and unknown kids", async () => {
    const token = await issueMandateToken(mandate, key);
    const [h, , s] = token.split(".");
    const forged = Buffer.from(canonicalize({ ...mandate, limits: {} })).toString("base64url");
    await expect(verifyMandateToken(`${h}.${forged}.${s}`, publicKeys)).rejects.toThrow(
      /signature is invalid/,
    );
    await expect(
      verifyMandateToken(token, { [KEY_ID]: generateKeyPair().publicKey }),
    ).rejects.toThrow(MandateTokenError);
    await expect(verifyMandateToken(token, { other: keys.publicKey })).rejects.toThrow(
      /unknown signing key/,
    );
  });

  it("rejects malformed tokens and wrong headers", async () => {
    await expect(verifyMandateToken("not-a-token", publicKeys)).rejects.toThrow(/malformed/);
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    await expect(
      verifyMandateToken(
        `${enc({ alg: "HS256", kid: KEY_ID, typ: "mandate+jws" })}.e30.sig`,
        publicKeys,
      ),
    ).rejects.toThrow(/alg/);
    await expect(
      verifyMandateToken(`${enc({ alg: "EdDSA", kid: KEY_ID, typ: "JWT" })}.e30.sig`, publicKeys),
    ).rejects.toThrow(/typ/);
    await expect(
      verifyMandateToken(`${enc({ alg: "EdDSA", typ: "mandate+jws" })}.e30.sig`, publicKeys),
    ).rejects.toThrow(/no kid/);
  });
});

describe("verify:chain CLI", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const fixture = fileURLToPath(new URL("../fixtures/sample-chain.json", import.meta.url));
  const pubkey = readFileSync(
    fileURLToPath(new URL("../fixtures/sample-chain.pubkey", import.meta.url)),
    "utf8",
  ).trim();
  const tsx = `${root}node_modules/.bin/tsx`;
  const cli = `${root}packages/crypto/src/cli/verify-chain.ts`;
  const runCli = (args: string[]) => {
    try {
      const stdout = execFileSync(tsx, [cli, ...args], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, INIT_CWD: root },
      });
      return { code: 0, out: stdout };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { code: e.status, out: e.stdout + e.stderr };
    }
  };

  it("verifies the committed sample chain", () => {
    expect(runCli(["--file", fixture, "--pubkey", pubkey])).toEqual({
      code: 0,
      out: "Chain verified: 4 receipts\n",
    });
    expect(
      runCli([
        "--file",
        "packages/crypto/fixtures/sample-chain.json",
        "--pubkey",
        pubkey,
        "--key-id",
        "fixture-key-1",
      ]).code,
    ).toBe(0);
  }, 30_000);

  it("exits non-zero for a wrong key or bad arguments", () => {
    const wrong = runCli(["--file", fixture, "--pubkey", generateKeyPair().publicKey]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toContain("Chain BROKEN at seq 1");
    expect(runCli(["--file", fixture]).code).toBe(2);
    expect(runCli(["--file", fixture, "--pubkey", "xyz"]).code).toBe(2);
    expect(runCli(["--file", "missing.json", "--pubkey", pubkey]).code).toBe(2);
  }, 30_000);

  it("the committed fixture is a valid chain", () => {
    const receipts = JSON.parse(readFileSync(fixture, "utf8")) as ChainReceipt[];
    expect(receipts.every((r) => SignedReceipt.safeParse(r).success)).toBe(true);
    expect(verifyChain(receipts, { "fixture-key-1": pubkey })).toEqual({ ok: true, count: 4 });
  });
});

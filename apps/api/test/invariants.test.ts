import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { client, harness, proposal, sellerMandateInput, tenantWithKeys } from "./helpers";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** Everything that runs while serving POST /v1/decide. */
const DECIDE_PATH = [
  "apps/api",
  "packages/engine",
  "packages/schema",
  "packages/policy",
  "packages/crypto",
  "packages/db",
];

const LLM_PACKAGES =
  /(^|["'/])(openai|@anthropic-ai\/[\w-]+|anthropic|langchain|@langchain\/[\w-]+|ollama|@google\/generative-ai|@google\/genai|cohere-ai|@mistralai\/[\w-]+|ai|@ai-sdk\/[\w-]+|llamaindex|replicate|groq-sdk|together-ai)["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "test") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

describe("no LLM in the /v1/decide path", () => {
  it("no package on the decide path depends on an LLM SDK", () => {
    for (const pkg of DECIDE_PATH) {
      const manifest = JSON.parse(readFileSync(join(REPO, pkg, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        expect(`"${dep}"`, `${pkg} depends on ${dep}`).not.toMatch(LLM_PACKAGES);
      }
    }
  });

  it("no source file on the decide path imports an LLM SDK", () => {
    const offenders: string[] = [];
    for (const pkg of DECIDE_PATH) {
      for (const file of sourceFiles(join(REPO, pkg, "src"))) {
        const text = readFileSync(file, "utf8");
        for (const line of text.split("\n")) {
          if (/\b(import|require)\b/.test(line) && LLM_PACKAGES.test(line)) {
            offenders.push(`${file}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("logging", () => {
  it("never logs API keys, request bodies or PII", async () => {
    const lines: string[] = [];
    const h = await harness({
      logger: { level: "trace", stream: { write: (l) => lines.push(l) } },
    });
    try {
      const keys = await tenantWithKeys(h.store);
      const admin = client(h.app, keys.admin);
      const agent = client(h.app, keys.agent);
      const created = await admin.post("/v1/mandates", sellerMandateInput());
      await agent.post("/v1/decide", {
        proposal: proposal(created.body.mandate.id, {
          type: "send_external_message",
          counterparty: "buyer_7731",
          reversible: false,
          body: "My address is 221B Baker Street, phone 98765 43210",
        }),
      });
      await client(h.app, "mk_wrong_key_value").get("/v1/me");
      const log = lines.join("\n");
      expect(lines.length).toBeGreaterThan(0);
      expect(log).not.toContain(keys.admin);
      expect(log).not.toContain(keys.agent);
      expect(log).not.toContain("mk_wrong_key_value");
      expect(log).not.toContain("221B Baker Street");
      expect(log).not.toContain("98765");
      expect(log).not.toContain(created.body.jws);
      expect(log).not.toContain(h.signer.privateKey);
    } finally {
      await h.close();
    }
  });
});

describe.runIf(Boolean(process.env.MANDATE_TEST_DATABASE_URL))("on a real Postgres", () => {
  it("keeps each tenant's chain linear under concurrent decides", async () => {
    const h = await harness({}, process.env.MANDATE_TEST_DATABASE_URL);
    try {
      const tenants = await Promise.all([tenantWithKeys(h.store), tenantWithKeys(h.store)]);
      const calls = [];
      for (const keys of tenants) {
        const created = await client(h.app, keys.admin).post("/v1/mandates", sellerMandateInput());
        const agent = client(h.app, keys.agent);
        for (let i = 0; i < 30; i++) {
          calls.push(
            agent.post("/v1/decide", {
              proposal: proposal(created.body.mandate.id, {
                type: "accept_price",
                counterparty: "b",
                reversible: false,
                amount_inr: 1000 + i * 100,
              }),
            }),
          );
        }
      }
      const results = await Promise.all(calls);
      expect(results.every((r) => r.status === 200)).toBe(true);
      for (const keys of tenants) {
        const verify = await client(h.app, keys.reader).get("/v1/receipts/verify");
        expect(verify.body).toMatchObject({ ok: true, count: 30 });
      }
    } finally {
      await h.close();
    }
  });
});

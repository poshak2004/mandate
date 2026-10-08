import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { CommitmentType, Policy } from "@mandate/schema";
import { isMap, isScalar, LineCounter, parseDocument, type Document } from "yaml";
import { z } from "zod";

/** An INR amount at the edge: non-negative, at most two decimal places (whole paise). */
const Inr = z
  .number()
  .nonnegative()
  .finite()
  .refine((inr) => Math.abs(inr * 100 - Math.round(inr * 100)) < 1e-6, {
    message: "INR amounts may have at most two decimal places",
  })
  .refine((inr) => Math.round(inr * 100) <= Number.MAX_SAFE_INTEGER, {
    message: "amount is too large",
  });

/** The authored YAML shape. Unknown keys are rejected at every level. */
export const PolicyYaml = z
  .object({
    /** Commitments of a type above this many INR need approval. */
    approval_thresholds_inr: z.record(CommitmentType, Inr).optional(),
    /** Irreversible commitments above this many INR escalate. */
    irreversible_risk_threshold_inr: Inr.nullable().optional(),
    required_evidence: z.record(CommitmentType, z.array(z.string().min(1))).optional(),
    blocked_counterparties: z.array(z.string().min(1)).optional(),
    agent_capabilities: z.record(z.string().min(1), z.array(CommitmentType)).optional(),
  })
  .strict();
export type PolicyYaml = z.infer<typeof PolicyYaml>;

export interface PolicyIssue {
  line: number;
  column: number;
  path: string;
  message: string;
}

/** Thrown when policy YAML cannot be parsed, validated or compiled. */
export class PolicyError extends Error {
  readonly issues: PolicyIssue[];
  constructor(source: string, issues: PolicyIssue[]) {
    const lines = issues.map(
      (i) => `  line ${i.line}, column ${i.column}${i.path ? ` (${i.path})` : ""}: ${i.message}`,
    );
    super(`Invalid policy ${source}:\n${lines.join("\n")}`);
    this.name = "PolicyError";
    this.issues = issues;
  }
}

const inrToPaise = (inr: number): number => Math.round(inr * 100);

/** Best source offset for a path: the deepest node that exists along it. */
function offsetOf(doc: Document, path: (string | number)[], key?: string): number {
  if (key !== undefined) {
    const parent = path.length === 0 ? doc.contents : doc.getIn(path, true);
    if (isMap(parent)) {
      const pair = parent.items.find((p) => isScalar(p.key) && p.key.value === key);
      const range = pair && isScalar(pair.key) ? pair.key.range : undefined;
      if (range) return range[0];
    }
  }
  for (let n = path.length; n > 0; n--) {
    const node = doc.getIn(path.slice(0, n), true) as
      { range?: [number, number, number] } | undefined;
    if (node && typeof node === "object" && node.range) return node.range[0];
  }
  return 0;
}

/** Compiles a validated YAML policy into the engine's Policy shape (INR -> paise). */
export function compilePolicy(yaml: PolicyYaml): Policy {
  const thresholds: Policy["approval_thresholds_paise"] = {};
  for (const [type, inr] of Object.entries(yaml.approval_thresholds_inr ?? {})) {
    if (inr !== undefined) thresholds[type as CommitmentType] = inrToPaise(inr);
  }
  const risk = yaml.irreversible_risk_threshold_inr;
  return Policy.parse({
    approval_thresholds_paise: thresholds,
    irreversible_risk_threshold_paise:
      risk === undefined || risk === null ? null : inrToPaise(risk),
    required_evidence: yaml.required_evidence ?? {},
    blocked_counterparties: yaml.blocked_counterparties ?? [],
    agent_capabilities: yaml.agent_capabilities ?? {},
  });
}

/**
 * Parses, validates and compiles policy YAML. Throws PolicyError with line numbers
 * for syntax errors, unknown keys and invalid values.
 */
export function loadPolicy(text: string, source = "<inline>"): Policy {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: false });

  if (doc.errors.length > 0) {
    throw new PolicyError(
      source,
      doc.errors.map((e) => {
        const pos = e.linePos?.[0] ?? lineCounter.linePos(e.pos[0]);
        return {
          line: pos.line,
          column: pos.col,
          path: "",
          message: e.message.split("\n")[0] ?? e.message,
        };
      }),
    );
  }

  const raw: unknown = doc.toJS() ?? {};
  const parsed = PolicyYaml.safeParse(raw);
  if (!parsed.success) {
    const issues: PolicyIssue[] = parsed.error.issues.flatMap((issue) => {
      const keys = issue.code === "unrecognized_keys" ? issue.keys : [undefined];
      return keys.map((key) => {
        const offset = offsetOf(doc, issue.path, key);
        const pos = lineCounter.linePos(offset);
        const path = [...issue.path, ...(key === undefined ? [] : [key])].join(".");
        const message = issue.code === "unrecognized_keys" ? `unknown key "${key}"` : issue.message;
        return { line: pos.line, column: pos.col, path, message };
      });
    });
    issues.sort((a, b) => a.line - b.line || a.column - b.column);
    throw new PolicyError(source, issues);
  }
  return compilePolicy(parsed.data);
}

/** Reads and compiles a policy YAML file. */
export function loadPolicyFile(path: string): Policy {
  return loadPolicy(readFileSync(path, "utf8"), basename(path));
}

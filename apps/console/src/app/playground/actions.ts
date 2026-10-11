"use server";

import { randomUUID } from "node:crypto";
import type { ProposalInput } from "@mandate/sdk";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { proposalFor, sanitizeRules, scenario } from "@/lib/scenarios";

export interface StepResult {
  decision: string;
  ruleId: string;
  reason: string;
  receiptId: string;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (err: unknown): { ok: false; error: string } => ({
  ok: false,
  error: err instanceof Error ? err.message : String(err),
});

/** Grants the scenario's agent a fresh mandate built from the rules the person chose. */
export async function startScenario(
  scenarioId: string,
  rawRules: Record<string, unknown>,
): Promise<Result<{ mandateId: string }>> {
  const s = scenario(scenarioId);
  if (!s) return { ok: false, error: "unknown scenario" };
  try {
    const rules = sanitizeRules(s, rawRules);
    const terms = s.mandate(rules);
    const { mandate } = await api().mandates.create({
      principal: s.principal,
      principal_kind: s.principalKind,
      agent: s.agent,
      scope: terms.scope as never,
      limits: terms.limits as never,
      requires_approval: terms.requires_approval as never,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    revalidatePath("/mandates");
    return { ok: true, mandateId: mandate.id };
  } catch (err) {
    return fail(err);
  }
}

/** The agent asks Mandate whether it may do what the move suggests. */
export async function tryMove(
  scenarioId: string,
  mandateId: string,
  moveId: string,
  amountInr: number,
): Promise<Result<{ step: StepResult; proposal: ProposalInput }>> {
  const s = scenario(scenarioId);
  const move = s?.moves.find((m) => m.id === moveId);
  if (!s || !move) return { ok: false, error: "unknown move" };
  const amount =
    Number.isFinite(amountInr) && amountInr >= 0 ? amountInr : (move.amount?.default ?? 0);
  const proposal = proposalFor(
    s,
    move,
    mandateId,
    amount,
    `pg_${randomUUID()}`,
  ) as unknown as ProposalInput;
  try {
    const d = await api().decide(proposal);
    revalidatePath("/");
    return {
      ok: true,
      proposal,
      step: { decision: d.decision, ruleId: d.rule_id, reason: d.reason, receiptId: d.receipt_id },
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The person answers an approval request. Mandate records it; the agent then asks again
 * with the same request, and this time the approval is part of the decision.
 */
export async function answerApproval(
  scenarioId: string,
  receiptId: string,
  approve: boolean,
  proposal: ProposalInput,
): Promise<Result<{ step: StepResult }>> {
  const s = scenario(scenarioId);
  if (!s) return { ok: false, error: "unknown scenario" };
  try {
    const resolved = await api().escalations.resolve(
      receiptId,
      approve ? "approve" : "reject",
      s.principal,
      approve ? "approved in the playground" : "rejected in the playground",
    );
    revalidatePath("/escalations");
    if (!approve) {
      // A rejection is final: the agent does not get to ask again for this request.
      return {
        ok: true,
        step: {
          decision: "REJECTED",
          ruleId: resolved.receipt.rule_id ?? "APPROVAL_REQUIRED",
          reason: resolved.receipt.body.reason,
          receiptId: resolved.receipt.id,
        },
      };
    }
    const d = await api().decide(proposal);
    revalidatePath("/");
    revalidatePath("/escalations");
    return {
      ok: true,
      step: { decision: d.decision, ruleId: d.rule_id, reason: d.reason, receiptId: d.receipt_id },
    };
  } catch (err) {
    return fail(err);
  }
}

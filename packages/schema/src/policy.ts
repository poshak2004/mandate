import { z } from "zod";
import { CommitmentType, Id, Paise } from "./common";

/**
 * A business policy in compiled form (what the engine consumes).
 * Authored as YAML with INR amounts; see packages/policy.
 */
export const Policy = z
  .object({
    /** Commitments of a type above this amount need approval. */
    approval_thresholds_paise: z.record(CommitmentType, Paise),
    /** Irreversible commitments above this amount escalate. null = no threshold. */
    irreversible_risk_threshold_paise: Paise.nullable(),
    /** Evidence keys that must be present in the proposal, per type. */
    required_evidence: z.record(CommitmentType, z.array(z.string().min(1))),
    /** Counterparties no agent may commit to, regardless of mandate. */
    blocked_counterparties: z.array(Id),
    /** Commitment types each listed agent is capable of. Unlisted agents are unconstrained. */
    agent_capabilities: z.record(Id, z.array(CommitmentType)),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;

/** A policy with no rules at all. */
export const EMPTY_POLICY: Policy = Object.freeze({
  approval_thresholds_paise: {},
  irreversible_risk_threshold_paise: null,
  required_evidence: {},
  blocked_counterparties: [],
  agent_capabilities: {},
}) as Policy;

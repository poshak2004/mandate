import pc from "picocolors";
import type { Commitment, DecisionKind } from "@mandate/schema";
import type { TimelineEvent } from "./scenario";

const LABEL_WIDTH = 9;
const label = (text: string, color: (s: string) => string) => color(text.padEnd(LABEL_WIDTH));
const time = (iso: string) => pc.dim(iso.slice(11, 16));
const indent = " ".repeat(6);

function rupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`;
}

export function describeCommitment(c: Commitment): string {
  switch (c.type) {
    case "accept_price":
    case "make_payment":
    case "issue_refund":
    case "book":
      return `${c.type} ${c.amount_paise} paise (${rupees(c.amount_paise)}) to ${c.counterparty}`;
    case "disclose_pii":
      return `disclose_pii [${c.pii_fields.join(", ")}] to ${c.counterparty}`;
    case "schedule_meeting":
      return `schedule_meeting (${c.location.kind}${c.location.description ? `: ${c.location.description}` : ""}) with ${c.counterparty}`;
    case "cancel":
      return `cancel ${c.target_ref}`;
    case "send_external_message":
      return `send_external_message to ${c.counterparty}`;
  }
}

const DECISION_STYLE: Record<DecisionKind, (s: string) => string> = {
  ALLOW: (s) => pc.bold(pc.green(s)),
  BLOCK: (s) => pc.bold(pc.red(s)),
  ESCALATE: (s) => pc.bold(pc.yellow(s)),
  RETRY: (s) => pc.bold(pc.cyan(s)),
  WAIT: (s) => pc.bold(pc.cyan(s)),
  REROUTE: (s) => pc.bold(pc.magenta(s)),
};
const DECISION_ICON: Record<DecisionKind, string> = {
  ALLOW: "✔",
  BLOCK: "✘",
  ESCALATE: "▲",
  RETRY: "↻",
  WAIT: "…",
  REROUTE: "↪",
};

/** Truncates a JWS for display; full tokens are never printed. */
export function truncateToken(token: string): string {
  return `${token.slice(0, 32)}…${token.slice(-8)} (${token.length} chars)`;
}

export function renderEvent(e: TimelineEvent): string[] {
  switch (e.kind) {
    case "mandate":
      return [
        `${time(e.at)} ${label("SELLER", pc.blue)} grants a mandate: ${e.summary.join(pc.dim(" · "))}`,
        `${indent}${label("token", pc.dim)} ${pc.dim(truncateToken(e.token))} ${e.tokenVerified ? pc.green("✔ EdDSA signature verified") : pc.red("✘ invalid")}`,
      ];
    case "buyer":
      return [`${time(e.at)} ${label("BUYER", pc.magenta)} ${pc.italic(`"${e.text}"`)}`];
    case "agent-proposal":
      return [
        `${time(e.at)} ${label("AGENT", pc.cyan)} proposes ${pc.bold(describeCommitment(e.proposal.commitment))}`,
      ];
    case "decision": {
      const d = e.decision;
      const style = DECISION_STYLE[d.decision];
      return [
        `${indent}${label("MANDATE", pc.bold)} ${style(`${DECISION_ICON[d.decision]} ${d.decision}`)} ${style(d.rule_id)}`,
        `${indent}${" ".repeat(LABEL_WIDTH)} ${pc.dim(d.reason)}`,
        `${indent}${label("receipt", pc.dim)} ${pc.dim(`#${e.receipt.seq}`)} ${pc.gray(e.receipt.hash.slice(0, 12))}`,
      ];
    }
    case "approval":
      return [
        `${time(e.at)} ${label("SELLER", pc.blue)} ${pc.green(e.text)}`,
        `${indent}${label("receipt", pc.dim)} ${pc.dim(`#${e.receipt.seq} approval`)} ${pc.gray(e.receipt.hash.slice(0, 12))}`,
      ];
    case "agent-action":
      return [
        `${time(e.at)} ${label("AGENT", pc.cyan)} ${e.text}`,
        `${indent}${" ".repeat(LABEL_WIDTH)} ${pc.bold(pc.red(`✘ ${e.harm}`))}`,
      ];
    case "agent-reply":
      return [`${time(e.at)} ${label("AGENT", pc.cyan)} ${e.text}`];
  }
}

export function heading(text: string, color: (s: string) => string): string {
  const bar = "━".repeat(Math.max(4, 72 - text.length - 4));
  return `\n${color(pc.bold(`━━ ${text} ${bar}`))}\n`;
}

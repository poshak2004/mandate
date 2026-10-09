import type { DecideResult } from "./types";

/** The API answered with an error status. */
export class MandateApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(`Mandate API ${status} ${code}: ${message}`);
    this.name = "MandateApiError";
  }
}

/** The API could not be reached (network failure or timeout). */
export class MandateNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MandateNetworkError";
  }
}

/** guard() refused to run an action because the decision was not ALLOW. */
export class MandateBlockedError extends Error {
  constructor(readonly result: DecideResult) {
    super(`Mandate ${result.decision} ${result.rule_id}: ${result.reason}`);
    this.name = "MandateBlockedError";
  }
}

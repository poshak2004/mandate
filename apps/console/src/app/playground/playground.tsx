"use client";

import type { ProposalInput } from "@mandate/sdk";
import Link from "next/link";
import { useState, useTransition } from "react";
import { explainRule, verdictLabel } from "@/lib/format";
import {
  defaultRules,
  fillAmount,
  SCENARIOS,
  type Move,
  type Rules,
  type Scenario,
} from "@/lib/scenarios";
import { answerApproval, startScenario, tryMove, type StepResult } from "./actions";

interface Step {
  key: number;
  move: Move;
  amount: number;
  proposal?: ProposalInput;
  result?: StepResult;
  /** Set once the person approved or rejected an approval request. */
  answer?: StepResult;
  error?: string;
}

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "border-emerald-200 bg-emerald-50 text-emerald-900",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-900",
  BLOCK: "border-rose-200 bg-rose-50 text-rose-900",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-900",
  ESCALATE: "border-amber-200 bg-amber-50 text-amber-900",
};
const ICON: Record<string, string> = {
  ALLOW: "✓",
  APPROVED: "✓",
  BLOCK: "✕",
  REJECTED: "✕",
  ESCALATE: "?",
};

export function Playground() {
  const [current, setCurrent] = useState<Scenario | null>(null);
  const [rules, setRules] = useState<Rules>({});
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pick = (s: Scenario) => {
    setCurrent(s);
    setRules(defaultRules(s));
    setAmounts(
      Object.fromEntries(s.moves.filter((m) => m.amount).map((m) => [m.id, m.amount!.default])),
    );
    setMandateId(null);
    setSteps([]);
    setError(null);
  };

  const begin = () =>
    startTransition(async () => {
      if (!current) return;
      const res = await startScenario(current.id, rules);
      if (!res.ok) return setError(res.error);
      setError(null);
      setMandateId(res.mandateId);
      setSteps([]);
    });

  const play = (move: Move) =>
    startTransition(async () => {
      if (!current || !mandateId) return;
      const amount = amounts[move.id] ?? 0;
      const key = Date.now();
      setSteps((prev) => [...prev, { key, move, amount }]);
      const res = await tryMove(current.id, mandateId, move.id, amount);
      setSteps((prev) =>
        prev.map((s) =>
          s.key === key
            ? res.ok
              ? { ...s, result: res.step, proposal: res.proposal }
              : { ...s, error: res.error }
            : s,
        ),
      );
    });

  const answer = (step: Step, approve: boolean) =>
    startTransition(async () => {
      if (!current || !step.result || !step.proposal) return;
      const res = await answerApproval(current.id, step.result.receiptId, approve, step.proposal);
      setSteps((prev) =>
        prev.map((s) =>
          s.key === step.key
            ? res.ok
              ? { ...s, answer: res.step }
              : { ...s, error: res.error }
            : s,
        ),
      );
    });

  // ---------------------------------------------------------------- 1. pick a scenario
  if (!current) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s)}
            className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow"
          >
            <div className="text-base font-semibold text-slate-900">{s.title}</div>
            <p className="mt-2 text-sm text-slate-600">{s.blurb}</p>
            <div className="mt-4 text-sm font-medium text-indigo-600">Try it →</div>
          </button>
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------- 2. set the rules
  if (!mandateId) {
    return (
      <div className="max-w-2xl">
        <button
          onClick={() => setCurrent(null)}
          className="mb-4 text-sm text-slate-500 hover:text-slate-800"
        >
          ← All scenarios
        </button>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{current.title}</h2>
          <p className="mt-1 text-sm text-slate-600">
            You are {current.you}. First, tell your agent what it may and may not do. Mandate will
            hold it to exactly this.
          </p>
          <div className="mt-6 space-y-5">
            {current.rules.map((field) => (
              <label key={field.key} className="flex items-start justify-between gap-6">
                <span>
                  <span className="block text-sm font-medium text-slate-800">{field.label}</span>
                  <span className="block text-xs text-slate-500">{field.help}</span>
                </span>
                {field.kind === "inr" ? (
                  <span className="flex items-center gap-1 text-sm">
                    ₹
                    <input
                      type="number"
                      min={0}
                      value={Number(rules[field.key])}
                      onChange={(e) => setRules({ ...rules, [field.key]: Number(e.target.value) })}
                      className="w-28 rounded-lg border-0 px-2 py-1.5 text-right ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-500"
                    />
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={Boolean(rules[field.key])}
                    onChange={(e) => setRules({ ...rules, [field.key]: e.target.checked })}
                    className="mt-1 h-5 w-5 rounded border-slate-300 text-indigo-600"
                  />
                )}
              </label>
            ))}
          </div>
          {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
          <button
            onClick={begin}
            disabled={pending}
            className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Setting up…" : "Give my agent these rules"}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- 3. play
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        {steps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            Your agent is live with your rules. Now play {current.them}: pick something to say on
            the right, and watch what your agent tries to do and what Mandate lets through.
          </div>
        ) : null}
        {steps.map((step) => (
          <StepCard
            key={step.key}
            step={step}
            scenario={current}
            pending={pending}
            onAnswer={answer}
          />
        ))}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
            You are {current.them}. Say…
          </div>
          <div className="space-y-2">
            {current.moves.map((move) => (
              <div key={move.id} className="rounded-lg border border-slate-200 p-2">
                {move.amount ? (
                  <label className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                    {move.amount.label} ₹
                    <input
                      type="number"
                      min={0}
                      value={amounts[move.id] ?? 0}
                      onChange={(e) =>
                        setAmounts({ ...amounts, [move.id]: Number(e.target.value) })
                      }
                      className="w-24 rounded-md border-0 px-2 py-1 text-right text-xs ring-1 ring-slate-300 ring-inset"
                    />
                  </label>
                ) : null}
                <button
                  onClick={() => play(move)}
                  disabled={pending}
                  className="w-full rounded-md bg-slate-100 px-3 py-2 text-left text-sm text-slate-800 hover:bg-indigo-50 disabled:opacity-50"
                >
                  “{fillAmount(move.says, amounts[move.id] ?? 0)}”
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="font-medium text-slate-800">Your rules</div>
          <ul className="mt-2 space-y-1 text-slate-600">
            {current.rules.map((f) => (
              <li key={f.key}>
                {f.kind === "inr"
                  ? `${f.label}: ₹${Number(rules[f.key]).toLocaleString("en-IN")}`
                  : `${rules[f.key] ? "✓" : "✕"} ${f.label}`}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setMandateId(null)}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Change rules
          </button>
          <span className="mx-2 text-slate-300">·</span>
          <button
            onClick={() => setCurrent(null)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Other scenario
          </button>
        </div>
      </aside>
    </div>
  );
}

function StepCard({
  step,
  scenario,
  pending,
  onAnswer,
}: {
  step: Step;
  scenario: Scenario;
  pending: boolean;
  onAnswer: (step: Step, approve: boolean) => void;
}) {
  const r = step.result;
  const final = step.answer ?? r;
  const happened = final && (final.decision === "ALLOW" || final.decision === "APPROVED");
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
          {fillAmount(step.move.says, step.amount)}
        </div>
      </div>
      <div className="mt-3 text-sm text-slate-600">
        <span className="font-medium text-slate-800">Your agent wants to:</span>{" "}
        {fillAmount(step.move.agentWants, step.amount)}
      </div>

      {step.error ? <p className="mt-3 text-sm text-rose-700">{step.error}</p> : null}
      {!r && !step.error ? <p className="mt-3 text-sm text-slate-400">Asking Mandate…</p> : null}

      {r ? <Verdict result={r} /> : null}

      {r?.decision === "ESCALATE" && !step.answer ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <span className="mr-2">You are {scenario.you}. Allow it?</span>
          <button
            disabled={pending}
            onClick={() => onAnswer(step, true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Yes, allow
          </button>
          <button
            disabled={pending}
            onClick={() => onAnswer(step, false)}
            className="rounded-md bg-white px-3 py-1.5 font-medium text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:opacity-50"
          >
            No
          </button>
        </div>
      ) : null}

      {step.answer ? <Verdict result={step.answer} afterAnswer /> : null}

      {final && final.decision !== "ESCALATE" ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-2.5 text-slate-600">
            <div className="font-semibold text-slate-700">With Mandate</div>
            {happened
              ? `${fillAmount(step.move.agentWants, step.amount)}: done, within your rules.`
              : "Nothing happened. The agent was stopped before acting."}
          </div>
          <div className="rounded-lg bg-slate-50 p-2.5 text-slate-600">
            <div className="font-semibold text-slate-700">Without Mandate</div>
            {fillAmount(step.move.withoutMandate, step.amount)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Verdict({ result, afterAnswer = false }: { result: StepResult; afterAnswer?: boolean }) {
  const style = VERDICT_STYLE[result.decision] ?? "border-slate-200 bg-slate-50 text-slate-800";
  const why =
    result.decision === "REJECTED"
      ? "You said no, so the agent won't do it."
      : afterAnswer && result.decision === "ALLOW"
        ? "You approved it, so the agent may go ahead."
        : explainRule(result.ruleId);
  return (
    <div className={`mt-3 flex items-start gap-3 rounded-lg border p-3 ${style}`}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/70 text-sm font-bold">
        {ICON[result.decision] ?? "•"}
      </span>
      <div className="min-w-0 text-sm">
        <div className="font-semibold">Mandate: {verdictLabel(result.decision)}</div>
        <div>{why}</div>
        <details className="mt-1 text-xs opacity-80">
          <summary className="cursor-pointer">Details</summary>
          <div className="mt-1">{result.reason}</div>
          <div className="mt-1">
            Recorded in the{" "}
            <Link href={`/receipts/${result.receiptId}`} className="underline">
              activity log
            </Link>{" "}
            ({result.ruleId}).
          </div>
        </details>
      </div>
    </div>
  );
}

import { Setup } from "@/components/setup";
import {
  Card,
  Empty,
  ErrorPanel,
  Mono,
  PageHeader,
  TextLink,
  Verdict,
  input,
  secondaryButton,
  td,
  th,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeProposal, formatTime, shortHash } from "@/lib/format";
import { param, type SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

const KINDS = ["", "decision", "approval", "outcome"] as const;
const VERDICTS = [
  "",
  "ALLOW",
  "BLOCK",
  "ESCALATE",
  "RETRY",
  "WAIT",
  "REROUTE",
  "APPROVED",
  "REJECTED",
  "executed",
  "refunded",
  "disputed",
  "failed",
];

export default async function Receipts({ searchParams }: { searchParams: SearchParams }) {
  if (!isConfigured()) return <Setup />;
  const params = await searchParams;
  const kind = param(params, "kind") as (typeof KINDS)[number] | undefined;
  const decision = param(params, "decision");
  const agent = param(params, "agent_id");
  const rule = param(params, "rule_id");
  const before = Number(param(params, "before_seq")) || undefined;

  let page;
  try {
    page = await api().receipts.search({
      order: "desc",
      limit: 50,
      kind: kind || undefined,
      decision: decision || undefined,
      agent_id: agent || undefined,
      rule_id: rule || undefined,
      before_seq: before,
    });
  } catch (error) {
    return <ErrorPanel error={error} />;
  }

  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ kind, decision, agent_id: agent, rule_id: rule }))
    if (v) next.set(k, v);
  if (page.next_cursor) next.set("before_seq", String(page.next_cursor));

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle="Every decision, approval and outcome, newest first. Each is signed and chained to the one before."
      />
      <Card className="mb-6">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end">
          <label className="text-xs font-medium text-slate-600">
            Kind
            <select name="kind" defaultValue={kind ?? ""} className={`${input} mt-1`}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k || "any"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Verdict
            <select name="decision" defaultValue={decision ?? ""} className={`${input} mt-1`}>
              {VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {v || "any"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Rule
            <input
              name="rule_id"
              defaultValue={rule ?? ""}
              placeholder="LIMIT_PII"
              className={`${input} mt-1`}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Agent
            <input
              name="agent_id"
              defaultValue={agent ?? ""}
              placeholder="marketplace-agent"
              className={`${input} mt-1`}
            />
          </label>
          <button className={secondaryButton}>Filter</button>
        </form>
      </Card>
      {page.receipts.length === 0 ? (
        <Empty>No receipts match.</Empty>
      ) : (
        <Card>
          <div className="-m-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Seq</th>
                  <th className={th}>Verdict</th>
                  <th className={th}>Rule</th>
                  <th className={th}>Proposal</th>
                  <th className={th}>Actor</th>
                  <th className={th}>Hash</th>
                  <th className={th}>Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page.receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className={td}>
                      <TextLink href={`/receipts/${r.id}`}>#{r.seq}</TextLink>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="mr-2 text-xs text-slate-400">{r.kind}</span>
                      <Verdict value={r.decision} />
                    </td>
                    <td className={td}>
                      <Mono>{r.rule_id ?? "—"}</Mono>
                    </td>
                    <td className={td}>{describeProposal(r.body.proposal)}</td>
                    <td className={td}>{r.body.actor}</td>
                    <td className={td}>
                      <Mono title={r.hash}>{shortHash(r.hash)}</Mono>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{formatTime(r.body.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {page.next_cursor ? (
        <div className="mt-4 text-right">
          <TextLink href={`/receipts?${next.toString()}`}>Older →</TextLink>
        </div>
      ) : null}
    </>
  );
}

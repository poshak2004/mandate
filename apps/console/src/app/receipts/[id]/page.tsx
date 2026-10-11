import { notFound } from "next/navigation";
import { MandateApiError } from "@mandate/sdk";
import { Setup } from "@/components/setup";
import {
  Card,
  ErrorPanel,
  Json,
  Mono,
  PageHeader,
  TextLink,
  Verdict,
  td,
  th,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeProposal, explainEntry, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const HEADINGS = {
  decision: "An agent asked",
  approval: "A person answered",
  outcome: "The agent reported back",
} as const;

export default async function ActivityDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return <Setup />;
  const { id } = await params;
  let data;
  try {
    data = await api().receipts.get(id);
  } catch (error) {
    if (error instanceof MandateApiError && error.status === 404) notFound();
    return <ErrorPanel error={error} />;
  }
  const { receipt: r, related } = data;
  const b = r.body;
  const why = explainEntry({ ...r, actor: b.actor });
  return (
    <>
      <PageHeader
        title={describeProposal(b.proposal)}
        subtitle={`${HEADINGS[r.kind]} · activity #${r.seq} · ${formatTime(b.created_at)}`}
        actions={<Verdict value={r.decision} />}
      />

      <Card title="What happened" className="mb-6">
        <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">Result</dt>
          <dd>
            <Verdict value={b.decision} />
          </dd>
          {why ? (
            <>
              <dt className="text-slate-500">Why</dt>
              <dd className="text-slate-900">{why}</dd>
            </>
          ) : null}
          <dt className="text-slate-500">Details</dt>
          <dd className="text-slate-700">{b.reason}</dd>
          <dt className="text-slate-500">{r.kind === "approval" ? "Answered by" : "Agent"}</dt>
          <dd>{b.actor}</dd>
          <dt className="text-slate-500">Permission used</dt>
          <dd>
            {b.mandate_ref ? (
              <TextLink href={`/mandates/${b.mandate_ref.id}`}>
                {b.mandate_ref.id} (version {b.mandate_ref.version})
              </TextLink>
            ) : (
              "none"
            )}
          </dd>
          <dt className="text-slate-500">Business rules</dt>
          <dd>{b.policy_version === null ? "none" : `version ${b.policy_version}`}</dd>
        </dl>
      </Card>

      {related.length > 0 ? (
        <Card title="The rest of this story" className="mb-6">
          <div className="-m-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Result</th>
                  <th className={th}>What happened</th>
                  <th className={th}>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {related.map((x) => (
                  <tr key={x.id}>
                    <td className={`${td} whitespace-nowrap`}>
                      <TextLink href={`/receipts/${x.id}`}>
                        <Verdict value={x.decision} />
                      </TextLink>
                    </td>
                    <td className={td}>
                      {HEADINGS[x.kind]}: {explainEntry({ ...x, actor: x.body.actor })}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{formatTime(x.body.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-700">
          Proof (for auditors and developers)
        </summary>
        <div className="space-y-4 border-t border-slate-100 p-5">
          <p className="text-sm text-slate-600">
            This entry is signed by Mandate and linked to the one before it, so nobody can edit or
            delete it without the whole log failing verification.
          </p>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm break-all">
            <dt className="text-slate-500">Entry id</dt>
            <dd>
              <Mono>{r.id}</Mono>
            </dd>
            <dt className="text-slate-500">Reason code</dt>
            <dd>
              <Mono>{b.rule_id ?? "—"}</Mono>
            </dd>
            <dt className="text-slate-500">Hash</dt>
            <dd>
              <Mono>{r.hash}</Mono>
            </dd>
            <dt className="text-slate-500">Previous</dt>
            <dd>
              <Mono>{r.prev_hash}</Mono>
            </dd>
            <dt className="text-slate-500">Signature</dt>
            <dd>
              <Mono>{r.signature}</Mono>
            </dd>
            <dt className="text-slate-500">Signed by key</dt>
            <dd>
              <Mono>{r.key_id}</Mono>
            </dd>
          </dl>
          <Json value={b} />
        </div>
      </details>
    </>
  );
}

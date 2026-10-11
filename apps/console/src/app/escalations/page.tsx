import { resolveEscalation } from "@/app/actions";
import { Flash } from "@/components/flash";
import { Setup } from "@/components/setup";
import {
  Card,
  Empty,
  ErrorPanel,
  Json,
  Mono,
  PageHeader,
  TextLink,
  Verdict,
  approveButton,
  input,
  rejectButton,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeProposal, formatTime } from "@/lib/format";
import { param, type SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default async function Escalations({ searchParams }: { searchParams: SearchParams }) {
  if (!isConfigured()) return <Setup />;
  const params = await searchParams;
  const done = param(params, "done");
  let list;
  try {
    list = (await api().escalations.list()).escalations;
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  return (
    <>
      <PageHeader
        title="Needs your approval"
        subtitle="Things an agent wanted to do that the rules say a person must OK first. Your answer is recorded; if you approve, the agent may go ahead when it asks again."
      />
      <Flash
        error={param(params, "error")}
        success={
          done
            ? `Escalation ${done === "approve" ? "approved" : "rejected"} and recorded.`
            : undefined
        }
      />
      {list.length === 0 ? (
        <Empty>Nothing is waiting for you. 🎉</Empty>
      ) : (
        <div className="space-y-4">
          {list.map((e) => (
            <Card
              key={e.receipt_id}
              title={
                <div className="flex flex-wrap items-center gap-3">
                  <Verdict value="ESCALATE" />
                  <Mono>{e.rule_id}</Mono>
                  <span className="font-normal text-slate-500">{describeProposal(e.proposal)}</span>
                </div>
              }
            >
              <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <div className="space-y-3 text-sm">
                  <p className="text-slate-800">{e.reason}</p>
                  <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-slate-600">
                    <dt>Agent</dt>
                    <dd>{e.agent_id ?? "—"}</dd>
                    <dt>Idempotency key</dt>
                    <dd>
                      <Mono>{e.idempotency_key}</Mono>
                    </dd>
                    <dt>Mandate</dt>
                    <dd>
                      {e.mandate_ref ? (
                        <TextLink href={`/mandates/${e.mandate_ref.id}`}>
                          {e.mandate_ref.id} v{e.mandate_ref.version}
                        </TextLink>
                      ) : (
                        "—"
                      )}
                    </dd>
                    <dt>Policy</dt>
                    <dd>{e.policy_version === null ? "none" : `v${e.policy_version}`}</dd>
                    <dt>Received</dt>
                    <dd>{formatTime(e.created_at)}</dd>
                    <dt>Receipt</dt>
                    <dd>
                      <TextLink href={`/receipts/${e.receipt_id}`}>{e.receipt_id}</TextLink>
                    </dd>
                  </dl>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-slate-500">
                      Proposal JSON
                    </summary>
                    <div className="mt-2">
                      <Json value={e.proposal} />
                    </div>
                  </details>
                </div>
                <form action={resolveEscalation} className="space-y-3 rounded-lg bg-slate-50 p-4">
                  <input type="hidden" name="receipt_id" value={e.receipt_id} />
                  <label className="block text-xs font-medium text-slate-600">
                    Resolved by
                    <input
                      name="resolved_by"
                      required
                      placeholder="seller_001"
                      className={`${input} mt-1`}
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Note (signed into the receipt)
                    <input name="note" placeholder="optional" className={`${input} mt-1`} />
                  </label>
                  <div className="flex gap-2">
                    <button name="resolution" value="approve" className={approveButton}>
                      Approve
                    </button>
                    <button name="resolution" value="reject" className={rejectButton}>
                      Reject
                    </button>
                  </div>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

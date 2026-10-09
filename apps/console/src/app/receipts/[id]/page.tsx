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
import { describeProposal, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReceiptDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return <Setup />;
  const { id } = await params;
  let data;
  try {
    data = await api().receipts.get(id);
  } catch (error) {
    if (error instanceof MandateApiError && error.status === 404) notFound();
    return <ErrorPanel error={error} />;
  }
  const { receipt: r, outcomes, related } = data;
  const b = r.body;
  return (
    <>
      <PageHeader
        title={`Receipt #${r.seq}`}
        subtitle={<Mono>{r.id}</Mono>}
        actions={<Verdict value={r.decision} />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What was decided">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Kind</dt>
            <dd>{b.kind}</dd>
            <dt className="text-slate-500">Verdict</dt>
            <dd>
              <Verdict value={b.decision} /> <Mono>{b.rule_id ?? ""}</Mono>
            </dd>
            <dt className="text-slate-500">Reason</dt>
            <dd className="text-slate-800">{b.reason}</dd>
            <dt className="text-slate-500">Proposal</dt>
            <dd>{describeProposal(b.proposal)}</dd>
            <dt className="text-slate-500">Actor</dt>
            <dd>{b.actor}</dd>
            <dt className="text-slate-500">Mandate</dt>
            <dd>
              {b.mandate_ref ? (
                <TextLink href={`/mandates/${b.mandate_ref.id}`}>
                  {b.mandate_ref.id} v{b.mandate_ref.version}
                </TextLink>
              ) : (
                "none"
              )}
            </dd>
            <dt className="text-slate-500">Policy</dt>
            <dd>{b.policy_version === null ? "none" : `v${b.policy_version}`}</dd>
            <dt className="text-slate-500">Engine</dt>
            <dd>{b.engine_version}</dd>
            <dt className="text-slate-500">Time</dt>
            <dd>{formatTime(b.created_at)}</dd>
            {r.ref_receipt_id ? (
              <>
                <dt className="text-slate-500">Refers to</dt>
                <dd>
                  <TextLink href={`/receipts/${r.ref_receipt_id}`}>{r.ref_receipt_id}</TextLink>
                </dd>
              </>
            ) : null}
          </dl>
        </Card>
        <Card title="Signature and chain">
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm break-all">
            <dt className="text-slate-500">Hash</dt>
            <dd>
              <Mono>{r.hash}</Mono>
            </dd>
            <dt className="text-slate-500">Prev hash</dt>
            <dd>
              <Mono>{r.prev_hash}</Mono>
            </dd>
            <dt className="text-slate-500">Signature</dt>
            <dd>
              <Mono>{r.signature}</Mono>
            </dd>
            <dt className="text-slate-500">Key id</dt>
            <dd>
              <Mono>{r.key_id}</Mono>
            </dd>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            hash = SHA-256(prev_hash ‖ RFC 8785 canonical body); the signature is Ed25519 over the
            hash.
          </p>
        </Card>
      </div>
      {related.length > 0 || outcomes.length > 0 ? (
        <Card title="Same proposal (idempotency key)" className="mt-6">
          <div className="-m-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Seq</th>
                  <th className={th}>Verdict</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {related.map((x) => (
                  <tr key={x.id}>
                    <td className={td}>
                      <TextLink href={`/receipts/${x.id}`}>#{x.seq}</TextLink>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="mr-2 text-xs text-slate-400">{x.kind}</span>
                      <Verdict value={x.decision} />
                    </td>
                    <td className={td}>{x.body.reason}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatTime(x.body.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card title="Signed body" className="mt-6">
        <Json value={b} />
      </Card>
    </>
  );
}

import { Setup } from "@/components/setup";
import {
  Badge,
  Card,
  Empty,
  ErrorPanel,
  Mono,
  PageHeader,
  Stat,
  TextLink,
  Verdict,
  td,
  th,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeProposal, formatTime, shortHash } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Overview() {
  if (!isConfigured()) return <Setup />;
  try {
    const client = api();
    const [me, verify, escalations, policies, recent] = await Promise.all([
      client.me(),
      client.receipts.verify(),
      client.escalations.list(),
      client.policies.list(),
      client.receipts.search({ order: "desc", limit: 12 }),
    ]);
    return (
      <>
        <PageHeader
          title={me.tenant.name}
          subtitle={
            <>
              Tenant <Mono>{me.tenant.id}</Mono> ·{" "}
              {me.tenant.mode === "enforce"
                ? "decisions are enforced"
                : "shadow mode: decisions are recorded, not enforced"}
            </>
          }
          actions={
            <Badge tone={me.tenant.mode === "enforce" ? "green" : "amber"}>{me.tenant.mode}</Badge>
          }
        />
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Receipt chain"
            value={
              verify.ok ? (
                <span className="text-emerald-700">Verified</span>
              ) : (
                <span className="text-rose-700">Broken</span>
              )
            }
            hint={
              verify.ok
                ? `${verify.count} receipts · head ${shortHash(verify.head_hash)}`
                : `at seq ${verify.first_broken_seq}: ${verify.reason}`
            }
          />
          <Stat
            label="Waiting for approval"
            value={escalations.escalations.length}
            hint={<TextLink href="/escalations">Review escalations</TextLink>}
          />
          <Stat
            label="Active policy"
            value={policies.active_version === null ? "None" : `v${policies.active_version}`}
            hint={`${policies.policies.length} version(s) uploaded`}
          />
          <Stat
            label="Signing key"
            value={<Mono>{me.signing_key.key_id}</Mono>}
            hint={shortHash(me.signing_key.public_key, 16)}
          />
        </div>
        <Card title="Latest receipts">
          {recent.receipts.length === 0 ? (
            <Empty>No receipts yet. Agents create them by calling POST /v1/decide.</Empty>
          ) : (
            <div className="-m-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Seq</th>
                    <th className={th}>Verdict</th>
                    <th className={th}>Rule</th>
                    <th className={th}>Proposal</th>
                    <th className={th}>Actor</th>
                    <th className={th}>Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.receipts.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className={td}>
                        <TextLink href={`/receipts/${r.id}`}>#{r.seq}</TextLink>
                      </td>
                      <td className={td}>
                        <span className="mr-2 text-xs text-slate-400">{r.kind}</span>
                        <Verdict value={r.decision} />
                      </td>
                      <td className={td}>
                        <Mono>{r.rule_id ?? "—"}</Mono>
                      </td>
                      <td className={td}>{describeProposal(r.body.proposal)}</td>
                      <td className={td}>{r.body.actor}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatTime(r.body.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </>
    );
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
}

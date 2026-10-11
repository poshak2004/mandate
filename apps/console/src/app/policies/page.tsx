import { uploadPolicy } from "@/app/actions";
import { Flash } from "@/components/flash";
import { Setup } from "@/components/setup";
import {
  Badge,
  Card,
  Empty,
  ErrorPanel,
  PageHeader,
  TextLink,
  primaryButton,
  td,
  th,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { param, type SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

const PLACEHOLDER = `approval_thresholds_inr:
  issue_refund: 5000
irreversible_risk_threshold_inr: 25000
required_evidence:
  accept_price: [offer_message_id]
blocked_counterparties: []
agent_capabilities: {}`;

export default async function Policies({ searchParams }: { searchParams: SearchParams }) {
  if (!isConfigured()) return <Setup />;
  const params = await searchParams;
  let data;
  try {
    data = await api().policies.list();
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  return (
    <>
      <PageHeader
        title="Business rules"
        subtitle="Rules your business applies to every agent, on top of each person's own limits (the stricter one always wins). Try a new version on past activity before switching it on."
      />
      <Flash error={param(params, "error")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card title="Versions">
          {data.policies.length === 0 ? (
            <Empty>No business rules yet: only each person's own permissions apply.</Empty>
          ) : (
            <div className="-m-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Version</th>
                    <th className={th}>Status</th>
                    <th className={th}>Uploaded</th>
                    <th className={th}>Published</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.policies.map((p) => (
                    <tr key={p.version} className="hover:bg-slate-50">
                      <td className={td}>
                        <TextLink href={`/policies/${p.version}`}>v{p.version}</TextLink>
                      </td>
                      <td className={td}>
                        {p.version === data.active_version ? (
                          <Badge tone="green">active</Badge>
                        ) : p.status === "draft" ? (
                          <Badge tone="amber">draft</Badge>
                        ) : (
                          <Badge>superseded</Badge>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{formatTime(p.created_at)}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatTime(p.published_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Write a new version">
          <form action={uploadPolicy} className="space-y-3">
            <textarea
              name="yaml"
              required
              rows={12}
              defaultValue={PLACEHOLDER}
              spellCheck={false}
              className="block w-full rounded-lg border-0 bg-slate-950 p-3 font-mono text-xs text-slate-100 ring-1 ring-slate-800 focus:ring-2 focus:ring-indigo-500"
            />
            <button className={primaryButton}>Save as draft</button>
          </form>
        </Card>
      </div>
    </>
  );
}

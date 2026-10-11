import { notFound } from "next/navigation";
import { MandateApiError } from "@mandate/sdk";
import { revokeMandate } from "@/app/actions";
import { Flash } from "@/components/flash";
import { Setup } from "@/components/setup";
import {
  Badge,
  Card,
  ErrorPanel,
  Json,
  Mono,
  PageHeader,
  rejectButton,
  td,
  th,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeLimits, formatTime } from "@/lib/format";
import { param, type SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default async function MandateDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  if (!isConfigured()) return <Setup />;
  const { id } = await params;
  const query = await searchParams;
  let data;
  try {
    data = await api().mandates.get(decodeURIComponent(id));
  } catch (error) {
    if (error instanceof MandateApiError && error.status === 404) notFound();
    return <ErrorPanel error={error} />;
  }
  const m = data.mandate;
  return (
    <>
      <PageHeader
        title={m.id}
        subtitle={`${m.principal} → ${m.agent} · version ${m.version}`}
        actions={
          m.revoked ? (
            <Badge tone="red">revoked</Badge>
          ) : (
            <form action={revokeMandate}>
              <input type="hidden" name="id" value={m.id} />
              <button className={rejectButton}>Revoke</button>
            </form>
          )
        }
      />
      <Flash
        error={param(query, "error")}
        success={
          param(query, "revoked")
            ? "Revoked. A new revoked version was signed and stored."
            : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What the agent may do">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Scope</dt>
            <dd>{m.scope.join(", ") || "nothing"}</dd>
            <dt className="text-slate-500">Limits</dt>
            <dd>
              <ul className="space-y-0.5">
                {describeLimits(m.limits).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </dd>
            <dt className="text-slate-500">Needs approval</dt>
            <dd>{m.requires_approval.join(", ") || "nothing"}</dd>
            <dt className="text-slate-500">Expires</dt>
            <dd>{formatTime(m.expires_at)}</dd>
          </dl>
        </Card>
        <Card title="Signed copy (for other systems to verify)">
          <p className="font-mono text-xs break-all text-slate-600">{data.jws}</p>
        </Card>
      </div>
      <Card title="History" className="mt-6">
        <div className="-m-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Version</th>
                <th className={th}>Created</th>
                <th className={th}>Scope</th>
                <th className={th}>Limits</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...data.history].reverse().map((v) => (
                <tr key={v.version}>
                  <td className={td}>
                    <Mono>v{v.version}</Mono>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatTime(v.created_at)}</td>
                  <td className={td}>{v.mandate.scope.join(", ")}</td>
                  <td className={td}>
                    <ul className="space-y-0.5 text-xs">
                      {describeLimits(v.mandate.limits).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </td>
                  <td className={td}>
                    {v.mandate.revoked ? <Badge tone="red">revoked</Badge> : <Badge>granted</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw data" className="mt-6">
        <Json value={m} />
      </Card>
    </>
  );
}

import { Setup } from "@/components/setup";
import { Badge, Card, Empty, ErrorPanel, PageHeader, TextLink, td, th } from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeLimits, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Mandates() {
  if (!isConfigured()) return <Setup />;
  let mandates;
  try {
    mandates = (await api().mandates.list()).mandates;
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  return (
    <>
      <PageHeader
        title="Mandates"
        subtitle="Grants of authority from a principal to one agent. Changes and revocations add a new signed version."
      />
      {mandates.length === 0 ? (
        <Empty>No mandates yet. Create one with POST /v1/mandates.</Empty>
      ) : (
        <Card>
          <div className="-m-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Mandate</th>
                  <th className={th}>Principal → agent</th>
                  <th className={th}>Scope</th>
                  <th className={th}>Limits</th>
                  <th className={th}>Expires</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mandates.map(({ mandate: m }) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className={td}>
                      <TextLink href={`/mandates/${m.id}`}>{m.id}</TextLink>
                      <div className="text-xs text-slate-400">v{m.version}</div>
                    </td>
                    <td className={td}>
                      {m.principal} → {m.agent}
                    </td>
                    <td className={td}>{m.scope.join(", ")}</td>
                    <td className={td}>
                      <ul className="space-y-0.5 text-xs">
                        {describeLimits(m.limits).map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{formatTime(m.expires_at)}</td>
                    <td className={td}>
                      {m.revoked ? (
                        <Badge tone="red">revoked</Badge>
                      ) : (
                        <Badge tone="green">active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

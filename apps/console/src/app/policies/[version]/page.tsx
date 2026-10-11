import { notFound } from "next/navigation";
import { MandateApiError } from "@mandate/sdk";
import { publishPolicy } from "@/app/actions";
import { Flash } from "@/components/flash";
import { Setup } from "@/components/setup";
import {
  Badge,
  Card,
  Empty,
  ErrorPanel,
  Json,
  Mono,
  PageHeader,
  TextLink,
  Verdict,
  primaryButton,
  td,
  th,
} from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { param, type SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default async function PolicyDetail({
  params,
  searchParams,
}: {
  params: Promise<{ version: string }>;
  searchParams: SearchParams;
}) {
  if (!isConfigured()) return <Setup />;
  const version = Number((await params).version);
  if (!Number.isInteger(version) || version <= 0) notFound();
  const query = await searchParams;
  const limit = Math.min(Math.max(Number(param(query, "limit")) || 200, 1), 10_000);

  let policy, list, backtest;
  try {
    const client = api();
    [policy, list, backtest] = await Promise.all([
      client.policies.get(version),
      client.policies.list(),
      // A backtest replays recorded decisions; it never changes anything.
      client.policies.backtest(version, limit),
    ]);
  } catch (error) {
    if (error instanceof MandateApiError && error.status === 404) notFound();
    return <ErrorPanel error={error} />;
  }
  const active = list.active_version === version;

  return (
    <>
      <PageHeader
        title={`Business rules, version ${version}`}
        subtitle={`Uploaded ${formatTime(policy.created_at)}${policy.published_at ? ` · published ${formatTime(policy.published_at)}` : ""}`}
        actions={
          policy.status === "draft" ? (
            <form action={publishPolicy}>
              <input type="hidden" name="version" value={version} />
              <button className={primaryButton}>Switch these rules on</button>
            </form>
          ) : (
            <Badge tone={active ? "green" : "slate"}>{active ? "active" : "superseded"}</Badge>
          )
        }
      />
      <Flash
        error={param(query, "error")}
        success={
          param(query, "published")
            ? `v${version} is published. New decisions use it from now on.`
            : undefined
        }
      />
      <Card
        title={
          <span>
            Test run: the last {backtest.evaluated} agent requests, re-checked with these rules ·{" "}
            <span className={backtest.flipped_count ? "text-amber-700" : "text-emerald-700"}>
              {backtest.flipped_count} would turn out differently
            </span>
          </span>
        }
        className="mb-6"
      >
        {backtest.flipped_count === 0 ? (
          <Empty>
            None of the recent activity would have turned out differently under these rules.
          </Empty>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              {Object.entries(backtest.transitions).map(([t, n]) => (
                <Badge key={t}>
                  {t}: {n}
                </Badge>
              ))}
            </div>
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Activity</th>
                    <th className={th}>What happened</th>
                    <th className={th}>With these rules</th>
                    <th className={th}>Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {backtest.flipped.map((f) => (
                    <tr key={f.receipt_id}>
                      <td className={td}>
                        <TextLink href={`/receipts/${f.receipt_id}`}>#{f.seq}</TextLink>
                        <div className="text-xs text-slate-400">{f.agent_id}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <Verdict value={f.before.decision} /> <Mono>{f.before.rule_id}</Mono>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <Verdict value={f.after.decision} /> <Mono>{f.after.rule_id}</Mono>
                      </td>
                      <td className={td}>{f.after.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="The rules (as written)">
          <pre className="overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-100">
            {policy.yaml}
          </pre>
        </Card>
        <Card title="As Mandate reads them (amounts in paise)">
          <Json value={policy.policy} />
        </Card>
      </div>
    </>
  );
}

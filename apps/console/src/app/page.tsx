import Link from "next/link";
import { Setup } from "@/components/setup";
import { Card, Empty, ErrorPanel, Stat, TextLink, Verdict, td, th } from "@/components/ui";
import { api, isConfigured } from "@/lib/api";
import { describeProposal, explainEntry, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "A person sets the rules",
    text: "“Sell my keyboard, never below ₹1,500. Never share my address. Ask me before meeting anyone.”",
  },
  {
    title: "The AI agent asks before it acts",
    text: "Before accepting a price, paying, sharing details or booking, the agent checks with Mandate.",
  },
  {
    title: "Mandate decides, and keeps proof",
    text: "Allowed, blocked, or sent to the person for approval. Every answer goes into a log nobody can quietly edit.",
  },
];

export default async function Home() {
  if (!isConfigured()) return <Setup />;
  try {
    const client = api();
    const [me, verify, escalations, policies, recent] = await Promise.all([
      client.me(),
      client.receipts.verify(),
      client.escalations.list(),
      client.policies.list(),
      client.receipts.search({ order: "desc", limit: 8 }),
    ]);
    const waiting = escalations.escalations.length;
    return (
      <>
        <section className="mb-8 rounded-2xl bg-slate-900 px-6 py-7 text-white md:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            Mandate keeps AI agents within what people allowed.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            AI agents now sell, book, pay and message on people&apos;s behalf. Mandate sits between
            the agent and the real world, so it can only do what the person agreed to.
          </p>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-xs font-semibold text-indigo-300">Step {i + 1}</div>
                <div className="mt-1 font-medium">{step.title}</div>
                <p className="mt-1 text-sm text-slate-300">{step.text}</p>
              </li>
            ))}
          </ol>
          <Link
            href="/playground"
            className="mt-6 inline-flex rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-indigo-50"
          >
            Try it in the Playground →
          </Link>
        </section>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Needs your approval"
            value={waiting}
            hint={waiting ? <TextLink href="/escalations">Review now</TextLink> : "Nothing waiting"}
          />
          <Stat
            label="Activity log"
            value={
              verify.ok ? (
                <span className="text-emerald-700">Intact</span>
              ) : (
                <span className="text-rose-700">Tampered</span>
              )
            }
            hint={
              verify.ok
                ? `${verify.count} entries, none edited or removed`
                : `Problem at entry #${verify.first_broken_seq}`
            }
          />
          <Stat
            label="Business rules"
            value={policies.active_version === null ? "None" : `Version ${policies.active_version}`}
            hint={
              me.tenant.mode === "enforce"
                ? "Decisions are enforced"
                : "Trial mode: decisions are logged, not enforced"
            }
          />
        </div>

        <Card
          title={
            <div className="flex items-center justify-between">
              <span>Latest activity</span>
              <TextLink href="/receipts">See all</TextLink>
            </div>
          }
        >
          {recent.receipts.length === 0 ? (
            <Empty>
              Nothing yet. Agents appear here as they ask permission.{" "}
              <TextLink href="/playground">Try the Playground</TextLink>.
            </Empty>
          ) : (
            <div className="-m-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Result</th>
                    <th className={th}>What the agent tried</th>
                    <th className={th}>Why</th>
                    <th className={th}>When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.receipts.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className={`${td} whitespace-nowrap`}>
                        <Link href={`/receipts/${r.id}`}>
                          <Verdict value={r.decision} />
                        </Link>
                      </td>
                      <td className={td}>
                        {describeProposal(r.body.proposal)}
                        <div className="text-xs text-slate-400">{r.body.actor}</div>
                      </td>
                      <td className={td}>{explainEntry({ ...r, actor: r.body.actor })}</td>
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

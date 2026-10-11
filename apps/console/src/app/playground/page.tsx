import { Setup } from "@/components/setup";
import { PageHeader } from "@/components/ui";
import { isConfigured } from "@/lib/api";
import { Playground } from "./playground";

export const dynamic = "force-dynamic";

export default function PlaygroundPage() {
  if (!isConfigured()) return <Setup />;
  return (
    <>
      <PageHeader
        title="Playground"
        subtitle="Set rules for an AI agent, then play the other side and see what Mandate lets it do. Everything here is real: each decision is recorded in the activity log."
      />
      <Playground />
    </>
  );
}

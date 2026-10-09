import { apiConfig } from "@/lib/api";
import { Card } from "./ui";

/** Shown when the console has no API key configured. */
export function Setup() {
  return (
    <Card title="Connect the console to the Mandate API">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>
          Start the API: <code className="font-mono">pnpm --filter @mandate/api dev</code>
        </li>
        <li>
          Create a tenant and keys:{" "}
          <code className="font-mono">pnpm bootstrap -- --name &quot;Acme&quot; --demo</code>
        </li>
        <li>
          Put the admin key in <code className="font-mono">apps/console/.env.local</code>:
          <pre className="mt-2 rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-100">
            {`MANDATE_API_URL=${apiConfig().baseUrl}\nMANDATE_ADMIN_KEY=mk_...`}
          </pre>
        </li>
        <li>Restart the console.</li>
      </ol>
      <p className="mt-4 text-xs text-slate-500">
        The key stays on the server: the console calls the API from server components and server
        actions only. The console has no login of its own, so run it locally or behind your own
        access control.
      </p>
    </Card>
  );
}

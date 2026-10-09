import "server-only";
import { MandateClient } from "@mandate/sdk";

/**
 * The console talks to the Mandate API from the server only, with an admin key that never
 * reaches the browser. Configure MANDATE_API_URL and MANDATE_ADMIN_KEY.
 */
export function apiConfig() {
  return {
    baseUrl: process.env.MANDATE_API_URL || "http://127.0.0.1:4000",
    apiKey: process.env.MANDATE_ADMIN_KEY || "",
  };
}

export function isConfigured(): boolean {
  return apiConfig().apiKey.length > 0;
}

export function api(): MandateClient {
  const { baseUrl, apiKey } = apiConfig();
  if (!apiKey) throw new Error("MANDATE_ADMIN_KEY is not set");
  return new MandateClient({ baseUrl, apiKey });
}

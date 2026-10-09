/**
 * Builds the Mandate HTTP API. Every /v1 route is authenticated with a tenant API key and
 * scoped to that tenant. Mandate decides and records; it never executes anything.
 */
import {
  ConflictError,
  type ApiKeyRow,
  type ApiScope,
  type Store,
  type TenantRow,
} from "@mandate/db";
import { PolicyError } from "@mandate/policy";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { ZodError } from "zod";
import { registerDecide } from "./routes/decide";
import { registerEscalations } from "./routes/escalations";
import { registerMandates } from "./routes/mandates";
import { registerOutcomes } from "./routes/outcomes";
import { registerPolicies } from "./routes/policies";
import { registerReceipts } from "./routes/receipts";

/** The key that signs receipts and mandate tokens. Never logged. */
export interface Signer {
  keyId: string;
  privateKey: string;
  publicKey: string;
}

export interface AppOptions {
  store: Store;
  signer: Signer;
  /** The clock, as an ISO-8601 UTC string. Injected so tests are deterministic. */
  now?: () => string;
  /** Fastify logger setting; false in tests. Bodies and credentials are never logged. */
  logger?: boolean | { level?: string; stream?: { write(msg: string): void } };
}

export interface Deps {
  store: Store;
  signer: Signer;
  now: () => string;
}

export interface Auth {
  tenant: TenantRow;
  apiKey: ApiKeyRow;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: Auth | null;
  }
  interface FastifyContextConfig {
    /** The API key scope this route needs. "admin" keys may call everything. */
    scope?: ApiScope;
  }
}

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);

/** The authenticated tenant; routes under /v1 always have one. */
export function auth(request: FastifyRequest): Auth {
  if (!request.auth) throw new HttpError(401, "unauthorized", "missing API key");
  return request.auth;
}

function presentedKey(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7).trim();
  const alt = request.headers["x-api-key"];
  return typeof alt === "string" ? alt.trim() : null;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const deps: Deps = {
    store: options.store,
    signer: options.signer,
    now: options.now ?? (() => new Date().toISOString()),
  };
  await deps.store.registerSigningKey(deps.signer.keyId, deps.signer.publicKey);

  const logger =
    options.logger === undefined || options.logger === false
      ? false
      : {
          ...(typeof options.logger === "object" ? options.logger : {}),
          // Credentials never reach the logs; request bodies are never logged at all.
          redact: ["req.headers.authorization", 'req.headers["x-api-key"]'],
        };
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });

  app.decorateRequest("auth", null);
  app.addContentTypeParser(
    ["application/yaml", "application/x-yaml", "text/yaml", "text/plain"],
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;
    const key = presentedKey(request);
    const found = key ? await deps.store.authenticate(key) : null;
    if (!found) {
      return reply.code(401).send({ error: "unauthorized", message: "missing or invalid API key" });
    }
    const needed = request.routeOptions.config?.scope ?? "admin";
    const scopes = found.apiKey.scopes;
    if (!scopes.includes("admin") && !scopes.includes(needed)) {
      return reply
        .code(403)
        .send({ error: "forbidden", message: `this API key lacks the "${needed}" scope` });
    }
    request.auth = found;
  });

  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message, ...error.extra });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "request failed validation",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (error instanceof PolicyError) {
      return reply
        .code(400)
        .send({ error: "invalid_policy", message: error.message, issues: error.issues });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: "conflict", message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: (error as Error).message });
    }
    // Unknown failures: log the error class only (messages can echo request data).
    logError(request.log, error);
    return reply.code(500).send({ error: "internal", message: "internal error" });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/v1/me", { config: { scope: "read" } }, async (request) => {
    const { tenant, apiKey } = auth(request);
    return {
      tenant: { id: tenant.id, name: tenant.name, mode: tenant.mode },
      api_key: { id: apiKey.id, name: apiKey.name, scopes: apiKey.scopes },
      signing_key: { key_id: deps.signer.keyId, public_key: deps.signer.publicKey },
    };
  });

  registerDecide(app, deps);
  registerMandates(app, deps);
  registerPolicies(app, deps);
  registerEscalations(app, deps);
  registerOutcomes(app, deps);
  registerReceipts(app, deps);
  return app;
}

function logError(log: FastifyBaseLogger, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown })?.code;
  log.error(
    { error: { name, code: typeof code === "string" ? code : undefined } },
    "request failed",
  );
}

/**
 * Runtime configuration from the environment (and an optional .env at the repo root).
 * Secrets (signing key, database URL) are never logged.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, publicKeyOf } from "@mandate/crypto";
import { DEFAULT_DATABASE_URL } from "@mandate/db";
import type { Signer } from "./app";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface Config {
  databaseUrl: string;
  autoMigrate: boolean;
  signer: Signer;
  host: string;
  port: number;
  production: boolean;
}

/** Loads REPO_ROOT/.env into process.env when present (Node >= 20.12). */
export function loadDotEnv(): void {
  const path = join(REPO_ROOT, ".env");
  const load = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (existsSync(path) && typeof load === "function") load(path);
}

const HEX64 = /^[0-9a-f]{64}$/;

function signerFromEnv(env: NodeJS.ProcessEnv, production: boolean, dataDir: string): Signer {
  const privateKey = env.MANDATE_SIGNING_KEY?.trim().toLowerCase();
  if (privateKey) {
    if (!HEX64.test(privateKey)) {
      throw new Error("MANDATE_SIGNING_KEY must be a 32-byte Ed25519 private key as 64 hex chars");
    }
    return {
      keyId: env.MANDATE_SIGNING_KEY_ID?.trim() || "mandate-key-1",
      privateKey,
      publicKey: publicKeyOf(privateKey),
    };
  }
  if (production) throw new Error("MANDATE_SIGNING_KEY is required when NODE_ENV=production");

  // Development only: a key generated once and kept in .mandate/ (git-ignored, mode 0600).
  const path = join(dataDir, "dev-signing-key.json");
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, "utf8")) as { keyId: string; privateKey: string };
    return { ...saved, publicKey: publicKeyOf(saved.privateKey) };
  }
  const pair = generateKeyPair();
  const saved = { keyId: `dev-${pair.publicKey.slice(0, 12)}`, privateKey: pair.privateKey };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, JSON.stringify(saved, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
  return { ...saved, publicKey: pair.publicKey };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const dataDir = resolve(REPO_ROOT, env.MANDATE_DATA_DIR || ".mandate");
  let databaseUrl = env.DATABASE_URL || DEFAULT_DATABASE_URL;
  if (databaseUrl.startsWith("pglite:") && databaseUrl !== "pglite:memory") {
    databaseUrl = `pglite:${resolve(REPO_ROOT, databaseUrl.slice("pglite:".length))}`;
  }
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT is invalid");
  return {
    databaseUrl,
    autoMigrate: env.MANDATE_AUTO_MIGRATE === "1" || databaseUrl.startsWith("pglite:"),
    signer: signerFromEnv(env, production, dataDir),
    host: env.HOST || "127.0.0.1",
    port,
    production,
  };
}

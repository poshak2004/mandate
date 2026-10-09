import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@mandate/sdk", "@mandate/schema", "@mandate/crypto"],
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // The repo's root ESLint config lints this app; `pnpm lint` runs it.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;

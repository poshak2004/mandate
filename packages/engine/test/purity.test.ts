import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

/** Anything that would let the engine read the clock, randomness, the environment or I/O. */
const FORBIDDEN: [string, RegExp][] = [
  ["Date.now", /\bDate\s*\.\s*now\b/],
  ["new Date()", /\bnew\s+Date\s*\(/],
  ["Math.random", /\bMath\s*\.\s*random\b/],
  ["process", /\bprocess\b/],
  ["fs", /\bfs\b/],
  ["fetch", /\bfetch\b/],
  ["require()", /\brequire\s*\(/],
  ["node: module", /["']node:/],
  ["performance", /\bperformance\b/],
  ["crypto", /\bcrypto\b/],
];

describe("engine purity", () => {
  const files = sourceFiles(SRC);

  it("finds the engine sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))(
    "%s does not reference the clock, randomness, environment or I/O",
    (_name, file) => {
      const text = readFileSync(file, "utf8");
      const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([label]) => label);
      expect(hits).toEqual([]);
    },
  );

  it("the scanner itself catches violations", () => {
    const bad =
      'import x from "node:fs"; const t = Date.now(); new Date(); Math.random(); process.env; fetch(u);';
    const hits = FORBIDDEN.filter(([, re]) => re.test(bad)).map(([label]) => label);
    expect(hits).toEqual(
      expect.arrayContaining([
        "Date.now",
        "new Date()",
        "Math.random",
        "process",
        "fs",
        "fetch",
        "node: module",
      ]),
    );
  });
});

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * - Object members are sorted by their keys' UTF-16 code units (JS default string order).
 * - Numbers use the ECMAScript Number-to-String algorithm (what JSON.stringify emits).
 * - Strings use JSON.stringify escaping, which matches RFC 8785.
 * - No insignificant whitespace.
 *
 * Values that JSON cannot represent (undefined at top level or in arrays, functions,
 * symbols, bigints, non-finite numbers) throw instead of being silently dropped.
 * Object members whose value is undefined are omitted, as JSON.stringify does.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value))
        throw new TypeError(`Cannot canonicalize non-finite number ${value}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
  }

  const obj = value as object;
  if (stack.has(obj)) throw new TypeError("Cannot canonicalize a cyclic structure");
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj
        .map((item) => {
          if (item === undefined) throw new TypeError("Cannot canonicalize undefined in an array");
          return serialize(item, stack);
        })
        .join(",")}]`;
    }
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(record[k], stack)}`).join(",")}}`;
  } finally {
    stack.delete(obj);
  }
}

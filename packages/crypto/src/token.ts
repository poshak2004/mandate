import { Mandate } from "@mandate/schema";
import { base64url, CompactSign, compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { canonicalize } from "./canonical";
import { publicKeyOf, toBytes, type PublicKeys, type SigningKey } from "./keys";

export const MANDATE_TOKEN_TYPE = "mandate+jws";

export class MandateTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MandateTokenError";
  }
}

async function privateJwk(privateKey: SigningKey["privateKey"]) {
  const d = toBytes(privateKey, 32, "private key");
  return importJWK(
    {
      kty: "OKP",
      crv: "Ed25519",
      d: base64url.encode(d),
      x: base64url.encode(toBytes(publicKeyOf(d), 32, "public key")),
    },
    "EdDSA",
  );
}

async function publicJwk(publicKey: string) {
  return importJWK(
    { kty: "OKP", crv: "Ed25519", x: base64url.encode(toBytes(publicKey, 32, "public key")) },
    "EdDSA",
  );
}

/**
 * Issues a compact JWS (EdDSA / Ed25519) whose payload is the RFC 8785 canonical JSON
 * of the mandate. The mandate is validated first.
 */
export async function issueMandateToken(mandate: Mandate, key: SigningKey): Promise<string> {
  const body = Mandate.parse(mandate);
  const payload = new TextEncoder().encode(canonicalize(body));
  return new CompactSign(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: key.keyId, typ: MANDATE_TOKEN_TYPE })
    .sign(await privateJwk(key.privateKey));
}

/**
 * Verifies a mandate token against known public keys (by kid) and returns the mandate.
 * Throws MandateTokenError on an unknown key, bad signature or invalid payload.
 * Expiry and revocation are not checked here: the engine checks them against context.now.
 */
export async function verifyMandateToken(
  token: string,
  publicKeys: PublicKeys,
): Promise<{ mandate: Mandate; keyId: string }> {
  let kid: string | undefined;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "EdDSA") throw new Error(`unexpected alg ${String(header.alg)}`);
    if (header.typ !== MANDATE_TOKEN_TYPE) throw new Error(`unexpected typ ${String(header.typ)}`);
    kid = header.kid;
  } catch (err) {
    throw new MandateTokenError(
      `malformed mandate token: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (kid === undefined || !Object.prototype.hasOwnProperty.call(publicKeys, kid)) {
    throw new MandateTokenError(`unknown signing key ${kid ?? "(no kid)"}`);
  }
  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(token, await publicJwk(publicKeys[kid] as string), {
      algorithms: ["EdDSA"],
    }));
  } catch {
    throw new MandateTokenError("mandate token signature is invalid");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new MandateTokenError("mandate token payload is not JSON");
  }
  const parsed = Mandate.safeParse(json);
  if (!parsed.success) throw new MandateTokenError("mandate token payload is not a valid mandate");
  return { mandate: parsed.data, keyId: kid };
}

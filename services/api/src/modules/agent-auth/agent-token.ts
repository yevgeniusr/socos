import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN =
  /^socos_agent_([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{43})$/;

export interface IssuedAgentToken {
  token: string;
  secretHash: string;
}

export interface ParsedAgentToken {
  credentialId: string;
  secret: string;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function issueAgentToken(credentialId: string): IssuedAgentToken {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(credentialId)) {
    throw new Error("Invalid agent credential identifier");
  }
  const secret = randomBytes(32).toString("base64url");
  return {
    token: `socos_agent_${credentialId}.${secret}`,
    secretHash: hashSecret(secret),
  };
}

export function parseAgentToken(token: unknown): ParsedAgentToken | null {
  if (typeof token !== "string") return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  return { credentialId: match[1], secret: match[2] };
}

export function verifyAgentTokenSecret(
  secret: string,
  storedHash: string
): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;
  const presented = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return timingSafeEqual(presented, expected);
}

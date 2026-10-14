#!/usr/bin/env node
/**
 * Mints the two long-lived HS256 keys the local stack hands to clients
 * (anon and service_role), the same shape the Supabase CLI prints.
 *
 * Usage: node scripts/stack/jwt.mjs <secret> <role>
 */
import { createHmac } from "node:crypto";

const [secret, role] = process.argv.slice(2);
if (!secret || !role) {
  console.error("usage: jwt.mjs <secret> <role>");
  process.exit(2);
}

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const header = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({ iss: "supabase-demo", role, iat: 1700000000, exp: 2000000000 });
const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${signature}`);

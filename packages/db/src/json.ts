import { z } from "zod";
import type { Json } from "./types";

/** Company and row identifiers are always UUIDs; validated at every repository boundary. */
export const UuidSchema = z.uuid();

/**
 * Converts a serialisable object or array into the `Json` type the generated
 * database types expect. Round-trips through JSON so undefined fields are
 * dropped and nothing non-serialisable reaches PostgREST.
 */
export function toJson(value: object): NonNullable<Json> {
  return JSON.parse(JSON.stringify(value)) as NonNullable<Json>;
}

/** True for a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the `text` field of a task `input` jsonb column; anything else yields "". */
export function readInputText(input: unknown): string {
  return isJsonObject(input) && typeof input.text === "string" ? input.text : "";
}

/** Today's date as the database sees it (UTC), formatted YYYY-MM-DD. */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

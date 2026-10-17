/**
 * TST-2: the rules of the cassette check, as pure functions over the text of one
 * cassette file (`cassette-check.ts` reads the directory and prints). The
 * patterns, the redaction markers and the way a body is read all come from the
 * gateway (`apps/worker/src/gateway/cassette`), so the check cannot disagree
 * with the code that wrote the file:
 *
 *   the file is a cassette, with no field the schema does not know
 *   its name is its key
 *   no body, header, path or metadata string holds an Anthropic key or a
 *     bearer token (a `@north.test` address other than `redacted@north.test`
 *     fails too, except in a reply, where it only warns: replies are stored
 *     verbatim and made-up addresses are expected there); bodies are read as
 *     the gateway reads them (JSON strings decoded, a stream's deltas joined)
 *   no credential header and no content-encoded reply (the gateway stores neither)
 *   the Agent SDK version (`meta`, else the stored user agent) is the pin
 *   unless scrubbing changed the request, the key recomputes from the stored
 *     path, `anthropic-beta` header and body
 *
 * A finding names the kind of secret and where it sits, never the secret.
 */
import { z } from "zod";
import { ANTHROPIC_KEY, BEARER_TOKEN, CassetteFileSchema, REDACTED_ADDRESS, REDACTED_BEARER, REDACTED_KEY, bodyTexts, cassetteKey, holdsOpenAddress, sdkVersionOf, type BodyText, type TextKind } from "../apps/worker/src/gateway/cassette";

// ---- the file as a strict schema ----------------------------------------------

const { shape } = CassetteFileSchema;
/** The gateway's schema with no unknown field at any level: the gateway's reader keeps accepting older files, the check does not accept a field it cannot scan. */
const StrictCassetteSchema = z.strictObject({
  key: shape.key,
  request: shape.request.strict(),
  response: shape.response.strict(),
  meta: shape.meta.unwrap().strict().optional(),
});
type Cassette = z.infer<typeof StrictCassetteSchema>;

// ---- secrets ------------------------------------------------------------------

const ADDRESS_KIND = `a @north.test address other than ${REDACTED_ADDRESS}`;

/**
 * The kinds of secret `text` holds, each named once, in words: an Anthropic key,
 * a bearer token, a `@north.test` address that is not `redacted@north.test`
 * (`kind` `json` when `text` is raw JSON, where `\n` is one character).
 * Empty for clean text, including text the gateway's scrubber has already
 * cleaned (a key is what the scrubber would still change). Never returns the
 * secret itself.
 */
export function secretFindings(text: string, kind: TextKind = "text"): readonly string[] {
  const found: string[] = [];
  if (text.replace(ANTHROPIC_KEY, REDACTED_KEY) !== text) found.push("an Anthropic key (sk-ant-...)");
  if (text.replace(BEARER_TOKEN, REDACTED_BEARER) !== text) found.push("a bearer token (Bearer ...)");
  if (holdsOpenAddress(text, kind)) found.push(ADDRESS_KIND);
  return found;
}

const headerOf = (headers: Readonly<Record<string, string>>, name: string): string => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? "";

/** Every other string of the file: key, method, path, each header as `name: value`, the recorded SDK version and time. */
function metadataText(data: Cassette): string {
  const headers = (side: Readonly<Record<string, string>>): string[] => Object.entries(side).map(([name, value]) => `${name}: ${value}`);
  return [data.key, data.request.method, data.request.path, ...headers(data.request.headers), ...headers(data.response.headers), data.meta?.sdkVersion ?? "", data.meta?.recordedAt ?? ""].join("\n");
}

interface Findings {
  readonly failures: string[];
  readonly warnings: string[];
}

/** Where a secret may sit, and whether an address there is only a warning (a reply echoes made-up addresses). */
function scanPlaces(data: Cassette): ReadonlyArray<{ readonly label: string; readonly texts: readonly BodyText[]; readonly addressWarns: boolean }> {
  const request = Buffer.from(data.request.body, "base64");
  const response = Buffer.from(data.response.body, "base64");
  return [
    { label: "request body", texts: bodyTexts(request, headerOf(data.request.headers, "content-type")), addressWarns: false },
    { label: "response body", texts: bodyTexts(response, headerOf(data.response.headers, "content-type")), addressWarns: true },
    { label: "headers, path or metadata", texts: [{ text: metadataText(data), kind: "text" }], addressWarns: false },
  ];
}

function secretProblems(data: Cassette): Findings {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const place of scanPlaces(data)) {
    for (const kind of new Set(place.texts.flatMap((reading) => secretFindings(reading.text, reading.kind)))) {
      if (kind === ADDRESS_KIND && place.addressWarns) warnings.push(`${place.label} holds ${kind}: replies are stored verbatim, so a made-up address in one is expected`);
      else failures.push(`${place.label} holds ${kind}`);
    }
  }
  return { failures, warnings };
}

// ---- headers ------------------------------------------------------------------

/** Headers that carry a credential or a session: the gateway never stores one, on either side. */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set(["authorization", "x-api-key", "proxy-authorization", "cookie", "set-cookie"]);

/** A header value fit to print (a short run of plain characters), else a placeholder: a finding must not echo what it flags. */
const printable = (value: string): string => (/^[A-Za-z0-9 ,.;=/_-]{1,32}$/.test(value) ? value : "unreadable");

function headerProblems(data: Cassette): string[] {
  const credential = (side: string, headers: Readonly<Record<string, string>>): string[] =>
    Object.keys(headers)
      .map((name) => name.toLowerCase())
      .filter((name) => CREDENTIAL_HEADERS.has(name))
      .map((name) => `${side} header "${name}" is a credential header: the gateway never stores one`);
  const encoding = headerOf(data.response.headers, "content-encoding").trim().toLowerCase();
  const encoded = encoding === "" || encoding === "identity" ? [] : [`the response is content-encoded (${printable(encoding)}): the gateway records plain bodies only, so its text cannot be scanned`];
  return [...credential("request", data.request.headers), ...credential("response", data.response.headers), ...encoded];
}

// ---- the key and the SDK version -------------------------------------------------

const MARKERS: readonly string[] = [REDACTED_KEY, REDACTED_BEARER, REDACTED_ADDRESS];

/** True when the stored key inputs (body, path, beta header) hold a redaction marker: the only way scrubbing leaves a trace. */
function holdsMarker(data: Cassette): boolean {
  const inputs = [Buffer.from(data.request.body, "base64").toString("latin1"), data.request.path, headerOf(data.request.headers, "anthropic-beta")];
  return inputs.some((text) => MARKERS.some((marker) => text.includes(marker)));
}

/** Why the key cannot be recomputed from the stored request, or does not come out as the file's key; null when it does. */
function rehashProblem(data: Cassette): string | null {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(data.request.body, "base64").toString("utf8"));
  } catch {
    return "the stored request body is not JSON, so its key cannot be recomputed";
  }
  const recomputed = cassetteKey({ path: data.request.path, betaHeader: headerOf(data.request.headers, "anthropic-beta"), body });
  return recomputed === data.key ? null : `the key recomputed from the stored request (path, anthropic-beta, body) is ${recomputed}, not ${data.key}: the request was edited, or the key rules changed since it was recorded`;
}

/**
 * The key check. Skipped only when `meta` says scrubbing changed the request and
 * the request shows it (a redaction marker): a `requestScrubbed` that lies about
 * an unmarked request is recomputed. A cassette with no `meta` was recorded
 * before scrubbing was written down, so a request that no longer hashes to its
 * name is only "unverifiable" there.
 */
function keyFindings(data: Cassette): Findings {
  const claimed = data.meta?.requestScrubbed === true;
  if (claimed && holdsMarker(data)) return { failures: [], warnings: [] };
  const problem = rehashProblem(data);
  if (problem === null) return { failures: [], warnings: [] };
  if (data.meta === undefined) return { failures: [], warnings: [`unverifiable (pre-meta cassette): ${problem}`] };
  return { failures: [claimed ? `${problem} (meta.requestScrubbed says scrubbed, but the stored request holds no redaction marker)` : problem], warnings: [] };
}

/**
 * The Agent SDK version against the pin. The recorded version is `meta.sdkVersion`
 * (else, for a cassette from before `meta`, the stored user agent's); a `meta`
 * that disagrees with the user agent fails, and a `claude-cli` user agent that
 * names no SDK warns instead of skipping the comparison.
 */
function sdkFindings(data: Cassette, pin: string): Findings {
  const userAgent = headerOf(data.request.headers, "user-agent");
  const fromAgent = sdkVersionOf(userAgent);
  const claimed = data.meta?.sdkVersion ?? null;
  const recorded = claimed ?? fromAgent;
  const failures: string[] = [];
  if (claimed !== null && fromAgent !== null && claimed !== fromAgent) failures.push(`meta.sdkVersion ${claimed} disagrees with the user agent's ${fromAgent}: the pin cannot be compared to an edited record`);
  if (recorded !== null && recorded !== pin) failures.push(`recorded with Agent SDK ${recorded}, but packages/agents/package.json pins ${pin}: re-record it (cassettes/README.md, Re-recording)`);
  const unnamed = recorded === null && userAgent.startsWith("claude-cli/");
  const warnings = unnamed ? [`SDK version not recorded: the user agent is ${printable(userAgent.split(" ")[0] ?? "")} but names no agent-sdk/<version>, so the pin cannot be compared`] : [];
  return { failures, warnings };
}

// ---- one file -----------------------------------------------------------------

/** A cassette file as read: its name in the directory and its text. */
export interface CassetteInput {
  readonly name: string;
  readonly text: string;
}

/** What the check found in one file: the reasons it fails and the reasons it only warns. */
export interface Verdict {
  readonly name: string;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

const verdict = (name: string, failures: readonly string[], warnings: readonly string[]): Verdict => Object.freeze({ name, failures: Object.freeze([...failures]), warnings: Object.freeze([...warnings]) });

type Parsed = { readonly ok: true; readonly data: Cassette } | { readonly ok: false; readonly reason: string };

/** The file as the strict schema reads it; the reason when it is not JSON or not a cassette. */
function parseFile(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the file is not JSON" };
  }
  const parsed = StrictCassetteSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, reason: `not a valid cassette: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}` };
}

/**
 * Every problem of one cassette file against the Agent SDK `pin`, all at once.
 * Pure: reads nothing, changes nothing.
 */
export function verdictFor(file: CassetteInput, pin: string): Verdict {
  const parsed = parseFile(file.text);
  if (!parsed.ok) return verdict(file.name, [parsed.reason], []);
  const { data } = parsed;
  const secrets = secretProblems(data);
  const sdk = sdkFindings(data, pin);
  const keys = keyFindings(data);
  const failures = [
    ...(file.name === `${data.key}.json` ? [] : [`the file name does not match its key ${data.key}: a renamed or copied cassette`]),
    ...secrets.failures,
    ...headerProblems(data),
    ...sdk.failures,
    ...keys.failures,
  ];
  return verdict(file.name, failures, [...secrets.warnings, ...sdk.warnings, ...keys.warnings]);
}

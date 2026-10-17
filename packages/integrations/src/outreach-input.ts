// SLS-K2 / CMP-1: the one boundary schema every outreach adapter parses a send with: plain addresses, one-line subject, the compliance parts.
import { singleAddress } from "@north/core";
import { z } from "zod";

/** No CR or LF anywhere: a value that becomes a header line can never start a second header. */
const ONE_LINE = /^[^\r\n]*$/;

/**
 * One plain address (`ada@example.com`, any case): what `z.email()` accepts and
 * core's `singleAddress` reads as exactly that address. No display name, no
 * list, no line break: never free-form header text.
 */
export const PlainAddressSchema = z
  .string()
  .max(254)
  .regex(ONE_LINE, "an address is one line")
  .pipe(z.email())
  .refine((value) => singleAddress(value) === value.toLowerCase(), { message: "a single plain address" });

/** At most this many copies per send; the gate checked every one of them (`addressesOf`). */
export const MAX_COPIES = 50;
const CopiesSchema = z.array(PlainAddressSchema).max(MAX_COPIES);

/** `<address>?subject=unsubscribe`, the address plain (no scheme, no `<`, `>`, `,`, quote or space). */
const UNSUBSCRIBE_MAILTO = /^[^\s<>,;"?@]+@[^\s<>,;"?@]+\?subject=unsubscribe$/;
/** An http(s) link with nothing that could close the `<…>` of the header or start another entry. */
const UNSUBSCRIBE_URL = /^https?:\/\/[^\s<>",]+$/;

/** CMP-1: the `List-Unsubscribe` targets: the mailbox's `mailto` and the worker's `/u/<token>` link. */
export const ListUnsubscribeSchema = z.strictObject({
  mailto: z.string().max(330).regex(UNSUBSCRIBE_MAILTO, "<address>?subject=unsubscribe"),
  url: z
    .string()
    .max(2048)
    .regex(UNSUBSCRIBE_URL, "an http(s) unsubscribe link")
    .refine((value) => URL.canParse(value), { message: "an http(s) unsubscribe link" }),
});

/** The sent message a reply answers (M4 review H2). */
export const InReplyToSchema = z.object({ messageId: z.string().min(1).max(200), threadId: z.string().min(1).max(200) });

/** The compliance footer as the worker builds it (`complianceFooter`): identity, address and the opt-out line. */
export const FOOTER_MAX_CHARS = 2000;

/**
 * What an outreach adapter accepts (`OutreachSendInput`), parsed before
 * anything is written or sent: `to`, `cc` and `bcc` plain single addresses, a
 * subject without line breaks, the optional footer and `List-Unsubscribe`
 * targets (CMP-1).
 */
export const OutreachSendInputSchema = z.object({
  companyId: z.string().min(1),
  to: PlainAddressSchema,
  subject: z.string().regex(ONE_LINE, "a subject is one line").trim().min(1).max(998),
  text: z.string().min(1).max(100_000),
  kind: z.enum(["first_contact", "reply"]),
  inReplyTo: InReplyToSchema.optional(),
  cc: CopiesSchema.optional(),
  bcc: CopiesSchema.optional(),
  footer: z.string().min(1).max(FOOTER_MAX_CHARS).optional(),
  unsubscribe: ListUnsubscribeSchema.optional(),
});
export type ParsedOutreachSendInput = z.output<typeof OutreachSendInputSchema>;

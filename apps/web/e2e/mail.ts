/** Reads magic links from the local Supabase mail catcher (Mailpit, port 54324). */
const MAIL_API = process.env.E2E_MAIL_API ?? "http://127.0.0.1:54324/api/v1";

interface MailSummary {
  ID: string;
  To: { Address: string }[];
  Created: string;
}

export async function latestMagicLink(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await fetch(`${MAIL_API}/messages?limit=20`).then((r) => r.json())) as { messages?: MailSummary[] };
    const mail = (list.messages ?? []).find((m) => m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()));
    if (mail) {
      const full = (await fetch(`${MAIL_API}/message/${mail.ID}`).then((r) => r.json())) as { Text?: string; HTML?: string };
      const body = `${full.Text ?? ""}\n${full.HTML ?? ""}`;
      const match = body.match(/https?:\/\/[^\s"'<>]+(?:token_hash|code)=[^\s"'<>]+/);
      if (match) return match[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No magic link for ${email} within ${timeoutMs}ms`);
}

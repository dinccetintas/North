// SEC-2: the worker's side of the agents' `SessionEntriesPort`. Transcript
// entries are stored under the run's company (`agent_session_entries`,
// append-only), and a read of a session another company wrote is refused
// before any entry is loaded. The repository is injected so the binding is
// testable without a database; `dbSessionRepo` binds it to `@north/db`.
import type { SessionEntriesPort } from "@north/agents";
import { appendSessionEntries, readSessionEntries, sessionCompanyId, type AppendSessionEntriesInput, type DbClient } from "@north/db";

/** The three session-entry repository calls the port needs. */
export interface SessionRepo {
  appendSessionEntries(input: AppendSessionEntriesInput): Promise<number>;
  readSessionEntries(sessionId: string, subpath: string): Promise<readonly unknown[]>;
  sessionCompanyId(sessionId: string): Promise<string | null>;
}

/** The repository over the worker's service-role client. */
export function dbSessionRepo(db: DbClient): SessionRepo {
  return Object.freeze({
    appendSessionEntries: (input: AppendSessionEntriesInput) => appendSessionEntries(db, input),
    readSessionEntries: (sessionId: string, subpath: string) => readSessionEntries(db, sessionId, subpath),
    sessionCompanyId: (sessionId: string) => sessionCompanyId(db, sessionId),
  });
}

/**
 * The port the Agent SDK session store writes through: `append` stores the
 * entries under the given company, `read` first asks who wrote the session and
 * throws `session <id> belongs to another company` for any company but the
 * given one (a session nobody wrote yet reads as empty), `companyOf` passes the
 * repository's answer through.
 */
export function sessionEntriesPort(repo: SessionRepo): SessionEntriesPort {
  return Object.freeze({
    append: (companyId: string, sessionId: string, subpath: string, entries: readonly unknown[], fromSeq: number) => repo.appendSessionEntries({ companyId, sessionId, subpath, entries, fromSeq }),
    async read(companyId: string, sessionId: string, subpath: string): Promise<readonly unknown[]> {
      const owner = await repo.sessionCompanyId(sessionId);
      if (owner !== null && owner !== companyId) throw new Error(`session ${sessionId} belongs to another company`);
      return repo.readSessionEntries(sessionId, subpath);
    },
    companyOf: (sessionId: string) => repo.sessionCompanyId(sessionId),
  });
}

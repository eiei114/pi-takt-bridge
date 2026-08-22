/**
 * @-mention session targeting for conversational TAKT input.
 * `@playground2 work on X` selects the session whose label matches.
 */
export function parseSessionMention(input: string): { token?: string; rest: string } {
  const match = /^@([\w.-]+)\s*(.*)$/.exec(input.trim());
  return match !== null
    ? { token: match[1], rest: match[2].trim() }
    : { rest: input.trim() };
}

export interface MentionTarget {
  label: string;
  cwd: string;
}

/**
 * Resolve an @token against session labels. Exact match wins, then a unique
 * prefix or suffix match (so `@playground2` matches `...-playground2`).
 */
export function resolveSessionByMention(
  sessions: readonly MentionTarget[],
  token: string,
): MentionTarget | undefined {
  const normalized = token.toLocaleLowerCase();
  const exact = sessions.find((session) => session.label.toLocaleLowerCase() === normalized);
  if (exact !== undefined) {
    return exact;
  }
  const bySuffix = sessions.filter((session) => session.label.toLocaleLowerCase().endsWith(normalized));
  if (bySuffix.length === 1) {
    return bySuffix[0];
  }
  const byPrefix = sessions.filter((session) => session.label.toLocaleLowerCase().startsWith(normalized));
  if (byPrefix.length === 1) {
    return byPrefix[0];
  }
  return undefined;
}
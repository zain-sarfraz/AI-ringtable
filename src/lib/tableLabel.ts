/** Normalize table labels so "table 3" does not become "Table table 3". */
export function displayTableLabel(tableNum?: string | null, opts?: { short?: boolean }): string {
  const raw = String(tableNum || "").trim();
  if (!raw) return opts?.short ? "—" : "Table";
  const stripped = raw.replace(/^table[\s._-]*/i, "").trim() || raw;
  if (opts?.short) return stripped;
  return `Table ${stripped}`;
}

/**
 * killReport — render a markdown audit of venues triaged for KILL, so the operator
 * can eyeball for false positives and rescue any they recognize. Pure; caller writes.
 */
export type KillReason = "dead" | "parked" | "no_site";

export interface KillEntry {
  name: string;
  neighborhood: string | null;
  reason: KillReason;
  urlTried: string | null;
  likelihood: number | null;
}

function pct(v: number | null): string {
  return v == null ? "?" : `${Math.round(v * 100)}%`;
}

function table(rows: KillEntry[], includeUrl: boolean): string {
  const head = includeUrl
    ? "| Venue | Neighborhood | Reason | URL tried | Likelihood |\n| --- | --- | --- | --- | --- |"
    : "| Venue | Neighborhood | Likelihood |\n| --- | --- | --- |";
  const body = rows
    .map((r) =>
      includeUrl
        ? `| ${r.name} | ${r.neighborhood ?? ""} | ${r.reason} | ${r.urlTried ?? ""} | ${pct(r.likelihood)} |`
        : `| ${r.name} | ${r.neighborhood ?? ""} | ${pct(r.likelihood)} |`,
    )
    .join("\n");
  return rows.length ? `${head}\n${body}` : "_none_";
}

export function renderKillReport(cityName: string, entries: KillEntry[]): string {
  const deadParked = entries.filter((e) => e.reason === "dead" || e.reason === "parked");
  const noSite = entries.filter((e) => e.reason === "no_site");
  return [
    `# ${cityName} — killed venues (site triage)`,
    "",
    "Venues we did NOT create/keep because no valid site was found. Review for false positives.",
    "",
    `## Killed: dead / parked sites (${deadParked.length})`,
    "",
    table(deadParked, true),
    "",
    `## No site on file — recognize any of these? (${noSite.length})`,
    "",
    "These had no real website on file (low HH-likelihood, so we did not auto-search). If you recognize one, add it via the normal submit flow.",
    "",
    table(noSite, false),
    "",
  ].join("\n");
}

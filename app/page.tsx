/**
 * Phase 0 palette / style-guide page. Confirms design tokens (§6.1) render.
 * Phase 1 replaces `/` with a redirect to the default city (`/tacoma`).
 */
const swatches = [
  { name: "bg-deep", var: "--bg-deep" },
  { name: "bg-surface", var: "--bg-surface" },
  { name: "bg-elevated", var: "--bg-elevated" },
  { name: "accent-warm", var: "--accent-warm" },
  { name: "accent-cool", var: "--accent-cool" },
  { name: "accent-hot", var: "--accent-hot" },
  { name: "text-primary", var: "--text-primary" },
  { name: "text-muted", var: "--text-muted" },
  { name: "border", var: "--border" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <p className="text-sm uppercase tracking-widest text-accent-cool">
        Happy Hour Friends
      </p>
      <h1
        className="mt-2 text-5xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Phase 0 — foundation is live.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-text-muted">
        Design tokens, schema, and migrations are wired. This page exists only to
        prove the palette renders; the city table replaces it in Phase 1.
      </p>

      {/* Palette */}
      <section className="mt-12">
        <h2
          className="text-2xl text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Palette
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {swatches.map((s) => (
            <div
              key={s.name}
              className="rounded-lg border border-border p-3"
              style={{ backgroundColor: "var(--bg-surface)" }}
            >
              <div
                className="h-12 w-full rounded-md border border-border"
                style={{ backgroundColor: `var(${s.var})` }}
              />
              <p className="mt-2 text-sm text-text-primary">{s.name}</p>
              <p className="text-xs text-text-muted">{s.var}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Sample table rows demonstrating tabular-nums + row states */}
      <section className="mt-12">
        <h2
          className="text-2xl text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Table preview
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="tabular-nums w-full text-left text-sm">
            <thead className="bg-bg-elevated text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Venue</th>
                <th className="px-4 py-2 font-medium">Start</th>
                <th className="px-4 py-2 font-medium">End</th>
                <th className="px-4 py-2 font-medium">Best deal</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              <tr className="border-t border-border">
                <td className="px-4 py-3">Top of Tacoma Bar</td>
                <td className="px-4 py-3">15:00</td>
                <td className="px-4 py-3">18:00</td>
                <td className="px-4 py-3 text-accent-warm">$5 well drinks</td>
              </tr>
              <tr
                className="border-t border-border"
                style={{
                  backgroundColor: "var(--row-promoted)",
                  borderLeft: "3px solid var(--accent-warm)",
                }}
              >
                <td className="px-4 py-3">Promoted venue</td>
                <td className="px-4 py-3">16:00</td>
                <td className="px-4 py-3">19:00</td>
                <td className="px-4 py-3 text-accent-warm">$2 off drafts</td>
              </tr>
              <tr className="border-t border-border text-text-muted">
                <td className="px-4 py-3" colSpan={3}>
                  Does this place have a happy hour?
                </td>
                <td className="px-4 py-3 text-accent-cool">Help us add it →</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-text-muted">
          ⚠ Flag/warning accent:{" "}
          <span className="text-accent-hot">discontinued report</span>
        </p>
      </section>
    </main>
  );
}

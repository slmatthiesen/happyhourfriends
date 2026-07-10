import type { Metadata } from "next";

/** Design-system reference (PRD §6.1). Not linked publicly. */

// Internal reference page — keep it out of the index even if the URL is discovered.
export const metadata: Metadata = {
  title: "Styleguide · Happy Hour Friends",
  robots: { index: false, follow: false },
};

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

export default function StyleGuide() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <h1
        className="text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Style guide
      </h1>
      <section className="mt-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {swatches.map((s) => (
            <div key={s.name} className="rounded-lg border border-border bg-bg-surface p-3">
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
    </main>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center">
      <p className="text-6xl">🍸</p>
      <h1
        className="mt-6 text-4xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Past last call
      </h1>
      <p className="mt-4 text-text-muted">
        This page doesn&apos;t exist — or it closed up and moved without telling
        us.
      </p>
      <Link
        href="/"
        className="mt-8 text-sm font-medium text-accent-cool hover:underline"
      >
        ← Back to the happy hours
      </Link>
    </main>
  );
}

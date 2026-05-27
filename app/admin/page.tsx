export default function AdminHome() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <h1
        className="text-3xl text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Admin queue
      </h1>
      <p className="mt-4 text-text-muted">
        Pending submissions, audit log, and budget dashboard arrive in Phases 2–4.
      </p>
    </main>
  );
}

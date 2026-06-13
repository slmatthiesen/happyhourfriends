import { mealSpecialQueue, hiddenWindowQueue } from "@/lib/recover/reviewQueues";
import { ReviewQueues } from "@/components/admin/review-queues";

export const dynamic = "force-dynamic";

/**
 * /admin/reviews — the web replacement for the CSV review round-trips
 * (review:meal-specials, review:hidden). Queues are recomputed from the DB on every
 * load with the same deterministic, $0 evidence rules the scripts use, so nothing
 * here is ever a stale report. Decisions write through the same audited paths.
 */
export default async function ReviewsPage() {
  const [meal, hidden] = await Promise.all([mealSpecialQueue(), hiddenWindowQueue()]);

  return (
    <main className="mt-8">
      <h1 className="text-3xl text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
        Review queues
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-text-muted">
        Deterministic sweeps over stored data — no AI, recomputed live. <strong>Meal
        specials</strong>: live windows that look like meal service or events rather than
        happy hours (suggested <em>hide</em> only with stated evidence; price alone never
        suggests action). <strong>Hidden windows</strong>: gate-hidden windows on stub
        venues (suggested <em>delete</em> only on hard service-hours evidence; promote is
        never suggested — set it only after verifying the happy hour yourself).
      </p>
      <ReviewQueues meal={meal} hidden={hidden} />
    </main>
  );
}

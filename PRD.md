# Happy Hour Friends — Product Requirements Document

**Version**: 1.0
**Status**: Pre-build, handoff to implementation agent
**Owner**: Solo developer (you)
**Target launch market**: Tacoma, WA

---

## 1. Product summary

A web app that aggregates restaurant and bar happy hours into a single sortable, filterable table. Users can submit corrections and additions. An AI moderation pipeline reviews every submission, verifies plausible changes against the venue's own website and social channels, auto-applies low-risk verified changes, and escalates high-risk or unverifiable changes to a human admin. The site never displays unverified or hallucinated data — empty venue rows become explicit "help us fill this in" entries.

The product's differentiator vs. existing aggregators is the table-first UX (sort by start time, end time, price, neighborhood; multi-filter by food/drink/category/tags) and an automated content moderation pipeline that lets the data scale without manual gatekeeping by the operator.

### 1.1 Core principles

1. **No hallucinated data.** Every field in the live dataset traces to a verifiable source. Missing data renders as a public "help wanted" prompt.
2. **Table-first.** The primary UX is a dense, sortable, filterable table. Per-venue pages exist for SEO but are secondary.
3. **Anonymous-friendly contributions.** No login required to submit. Trust is built on fingerprint + IP history, not accounts.
4. **AI gates writes, not reads.** Reads are public and fast. Writes go through a classifier → verifier → auto-apply / queue pipeline.
5. **Sabotage-resistant.** Critical changes (discontinuation, large price swings) require corroboration, AI verification, or admin approval — never one anonymous submission.
6. **Budget-capped AI.** Hard ceiling enforced in code before every paid API call.

### 1.2 Non-goals for v1

- No mobile native app (React Native deferred — Next.js web only)
- No user accounts (admin-only auth via Firebase)
- No reviews, ratings, or photos beyond Google Places thumbnails
- No embedded maps (deep-link to Google/Apple Maps instead)
- No public API
- No multi-language
- No payments / monetization (schema-ready; UI deferred)
- No hours-of-operation tracking (happy hour windows only)

---

## 2. Tech stack (pinned)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15+ (App Router) | SSR for SEO on table + venue pages |
| Language | TypeScript 5+ | Strict mode |
| Database | PostgreSQL 16+ with PostGIS | DO Managed Database |
| ORM | Drizzle ORM (latest) | Raw SQL escape hatch for PostGIS |
| Job queue | pg-boss (latest) | Postgres-native, no Redis dependency |
| Styling | Tailwind CSS 4 + shadcn/ui | |
| Admin auth | Firebase Auth | Operator login only |
| Captcha | hCaptcha | Free tier |
| Email | Resend | Outreach + transactional |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) | Models below |
| Hosting | DigitalOcean droplet + DO Managed Postgres (SFO3) | $15/mo Postgres tier minimum for 7-day PITR backups |
| DNS / Email forwarding | Cloudflare (free) | `help@happyhourfriends.com` → personal email |
| Errors | Sentry free tier | |
| Uptime | UptimeRobot free tier | |
| Analytics | PostHog (free tier) | Funnel + session replay for submission flow |

### 2.1 Models

- **Stage 1 classifier**: `claude-haiku-4-5` ($1/$5 per M tokens)
- **Stage 2 verifier**: `claude-sonnet-4-6` ($3/$15 per M tokens) with tool use (`web_fetch`, `web_search`)

Both model IDs are env-overridable (`ANTHROPIC_MODEL_CLASSIFIER`, `ANTHROPIC_MODEL_VERIFIER`) so they can be swapped without a deploy.

### 2.2 Repo layout

```
/app                     Next.js App Router
  /(public)              Table, venue pages, neighborhood pages
  /admin                 Firebase-auth-gated admin queue + audit views
  /api                   Submission endpoints, webhook handlers
/components              Shared React components
/db
  /schema                Drizzle table definitions
  /migrations            drizzle-kit generated migrations
  /seed                  Seed scripts (discovery + enrichment)
/lib
  /ai                    Classifier, verifier, prompt templates, budget ledger
  /geo                   Neighborhood lookup, distance, timezone
  /trust                 Fingerprint + trust score logic
  /verification          Source-fetch tools used by Stage 2
/jobs                    pg-boss handlers (verification, outreach, re-verification cron)
/scripts                 One-off operational scripts
/prompts                 Markdown prompt templates (versioned)
PRD.md                   This file
.env.example
```

---

## 3. Data model

All tables include `created_at`, `updated_at`. `deleted_at` is soft-delete for user-impacting rows.

### 3.1 `venues`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| slug | text unique | URL-safe, derived |
| address | text | Formatted address from Google Places |
| lat | numeric(10,7) | |
| lng | numeric(10,7) | |
| timezone | text | IANA, e.g. `America/Los_Angeles` |
| neighborhood_id | uuid FK → neighborhoods | Nullable; auto-assigned via PostGIS contains() |
| city | text | |
| state | text | |
| type | enum `venue_type` | See below |
| chain_id | uuid FK → chains | Nullable |
| website_url | text | |
| other_url | text | Facebook, Instagram, Linktree, etc. |
| google_place_id | text unique | Canonical reference |
| phone | text | |
| status | enum `venue_status` | `active`, `closed`, `paused`, `no_happy_hour` |
| flagged_at | timestamp | Soft flag for "claim under review" |
| flag_reason | text | |
| flag_vote_count | int | Active community flag tally |
| promotion_tier | enum `promotion_tier` | `none`, `highlight`, `pin`, `banner` |
| promotion_starts_at | timestamp | |
| promotion_ends_at | timestamp | |
| data_completeness | enum `data_completeness` | `stub`, `partial`, `complete`, `verified` |
| last_verified_at | timestamp | |
| claimed_by_user_id | uuid | Nullable; future use |
| deleted_at | timestamp | Soft delete |

**Enum `venue_type`**: `restaurant`, `bar`, `sports_bar`, `pub`, `dive_bar`, `wine_bar`, `brewery`, `tasting_room`, `cocktail_lounge`, `gastropub`, `club`, `cafe`, `hotel_bar`, `pizzeria`, `other`

**Enum `venue_status`**: `active`, `closed`, `paused`, `no_happy_hour`

**Enum `data_completeness`**:
- `stub`: Name + address + place_id only (from Google Places discovery)
- `partial`: Some happy hour data confirmed, but incomplete
- `complete`: Full happy hour data, recently verified
- `verified`: Complete + verified within last 60 days

### 3.2 `chains`

| Column | Type |
|---|---|
| id | uuid PK |
| name | text |
| slug | text unique |
| logo_url | text |

### 3.3 `happy_hours`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| venue_id | uuid FK → venues | |
| day_of_week | smallint | **ISO 8601: 1=Monday, 7=Sunday** |
| start_time | time | Venue-local time |
| end_time | time | Venue-local time |
| crosses_midnight | boolean | Computed: `end_time < start_time` |
| location_within_venue | enum | `bar`, `patio`, `dining`, `all` |
| valid_from | date | Nullable; seasonal start |
| valid_until | date | Nullable; seasonal end |
| notes | text | Free text, e.g. "no holidays" |
| active | boolean | |
| source_url | text | URL backing this entry |
| deleted_at | timestamp | |

**Constraint**: `(venue_id, day_of_week, start_time, end_time, location_within_venue)` unique among non-deleted rows.

### 3.4 `happy_hour_exceptions`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| happy_hour_id | uuid FK | |
| exception_date | date | |
| type | enum | `closed`, `modified` |
| override_start_time | time | Nullable |
| override_end_time | time | Nullable |
| reason | text | "Mariners home game", "Thanksgiving", etc. |

### 3.5 `offerings`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| happy_hour_id | uuid FK | |
| kind | enum | `food`, `drink`, `other` |
| category | enum | `beer`, `wine`, `cocktail`, `spirit`, `appetizer`, `entree`, `dessert`, `other` |
| name | text | E.g. "Well drinks", "House wine", "Sliders" |
| price_cents | int | Nullable (some offerings are "$2 off") |
| original_price_cents | int | Nullable; for "$2 off original $X" math |
| discount_cents | int | Nullable; for explicit "$2 off" |
| description | text | |
| conditions | text | "Bar only", "with drink purchase", etc. |
| location_restriction | enum | Same as `happy_hours.location_within_venue` |
| source_url | text | |
| active | boolean | |
| deleted_at | timestamp | |

### 3.6 `tags` + `venue_tags`

```
tags(id, slug unique, label, category enum)
venue_tags(venue_id, tag_id) — composite PK
```

**Tag categories**: `vibe`, `amenity`, `cuisine`, `other`

**Seed tag set**:
- Vibe: `dive`, `upscale`, `casual`, `romantic`, `lively`, `quiet`, `family_friendly`, `21_plus`, `lgbtq_friendly`
- Amenity: `patio`, `rooftop`, `dog_friendly`, `live_music`, `trivia_night`, `karaoke`, `late_night`, `view`, `parking`, `reservations`, `walk_in_only`, `cash_only`
- Cuisine: `american`, `italian`, `mexican`, `asian`, `pizza`, `seafood`, `bbq`, `vegan_options`
- Other: `sports` (use for sports bar overlap), `happy_hour_all_day`, `weekend_happy_hour`

### 3.7 `neighborhoods`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| city | text | |
| state | text | |
| name | text | |
| slug | text | |
| polygon | geometry(MultiPolygon, 4326) | PostGIS |
| source | text | "City of Tacoma GIS — Neighborhood Council Districts" |
| source_url | text | |
| parent_id | uuid FK → neighborhoods | Nullable; for sub-districts |

Unique on `(city, slug)`.

GIST index on `polygon`. Auto-assign `venues.neighborhood_id` via:
```sql
UPDATE venues SET neighborhood_id = (
  SELECT n.id FROM neighborhoods n
  WHERE ST_Contains(n.polygon, ST_SetSRID(ST_MakePoint(venues.lng, venues.lat), 4326))
  ORDER BY n.parent_id NULLS LAST  -- prefer most specific
  LIMIT 1
);
```

### 3.8 `edit_submissions`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| target_type | enum | `venue`, `happy_hour`, `offering`, `new_venue` |
| target_id | uuid | Nullable for `new_venue` |
| diff_jsonb | jsonb | `{before: {...}, after: {...}}` |
| submitter_fingerprint | text | Browser fingerprint hash |
| submitter_ip | inet | |
| submitter_email | text | Nullable, optional |
| ai_risk_score | smallint | 0–100, populated by Stage 1 |
| ai_risk_level | enum | `low`, `medium`, `high`, `critical` |
| ai_verdict | enum | `auto_apply`, `verify`, `queue_outreach`, `queue_admin`, `reject` |
| ai_classifier_reasoning | text | |
| ai_evidence_jsonb | jsonb | Stage 2 output |
| status | enum | `pending`, `classifying`, `verifying`, `auto_applied`, `queued_outreach`, `queued_admin`, `applied`, `rejected`, `reverted`, `budget_exhausted` |
| applied_by | text | `ai`, `admin`, or fingerprint |
| created_at | timestamp | |
| decided_at | timestamp | |

### 3.9 `verification_attempts`

| Column | Type |
|---|---|
| id | uuid PK |
| submission_id | uuid FK |
| source | enum: `website`, `facebook`, `instagram`, `google`, `yelp`, `other` |
| url | text |
| fetched_at | timestamp |
| ai_summary | text |
| supports_change | boolean nullable |
| confidence | numeric(3,2) |

### 3.10 `community_flags`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| target_type | enum | `venue`, `happy_hour` |
| target_id | uuid | |
| flag_type | enum | `discontinued`, `price_increase`, `hours_changed`, `closed`, `other` |
| vote_value | enum | `confirm`, `deny` |
| submitter_fingerprint | text | |
| submitter_ip | inet | |
| reason | text | |
| created_at | timestamp | |
| resolved_at | timestamp | |
| resolution | enum | `confirmed`, `rejected`, `expired` |

**Resolution rules**:
- 5 distinct-fingerprint `confirm` votes within 14 days → flag resolved as `confirmed`, change applied, admin notified
- 3+ `deny` votes outweigh confirms → resolved as `rejected`, submitter trust decremented
- 14 days no resolution → escalate to admin
- AI verification can short-circuit either way

### 3.11 `submitter_trust`

| Column | Type | Notes |
|---|---|---|
| fingerprint | text PK | |
| ip_hashes | text[] | Hashed IPs seen |
| submission_count | int | |
| accuracy_count | int | Submissions later confirmed correct |
| inaccuracy_count | int | Submissions later confirmed wrong |
| trust_score | int | -100 to 100, starts at 0 |
| first_seen | timestamp | |
| last_seen | timestamp | |
| banned | boolean | |

### 3.12 `ai_usage_ledger`

| Column | Type |
|---|---|
| id | uuid PK |
| month | date (first of month) |
| model | text |
| input_tokens | int |
| output_tokens | int |
| cost_cents | int |
| stage | enum: `classify`, `verify`, `reverify_cron`, `seed` |
| submission_id | uuid nullable |
| created_at | timestamp |

Index on `(month, stage)`.

### 3.13 `audit_log`

| Column | Type |
|---|---|
| id | uuid PK |
| table_name | text |
| row_id | uuid |
| before_jsonb | jsonb |
| after_jsonb | jsonb |
| actor | text — `ai`, `admin:<email>`, `fingerprint:<hash>` |
| reason | text |
| created_at | timestamp |

Every write to `venues`, `happy_hours`, `offerings` writes here via DB trigger or app-layer middleware. Required for revert capability.

### 3.14 `seed_candidates` (operational, not public-facing)

| Column | Type |
|---|---|
| id | uuid PK |
| name | text |
| google_place_id | text unique |
| address | text |
| lat | numeric |
| lng | numeric |
| city | text |
| source_url | text |
| processed_at | timestamp |
| outcome | enum: `confirmed_hh`, `no_hh_found`, `no_hh_explicit`, `error` |
| resulting_venue_id | uuid FK |

---

## 4. AI moderation pipeline

### 4.1 Three-stage flow

```
Submission → Stage 1 (Haiku, classify + risk)
           → Stage 2 (Sonnet, verify with tool use)  [skipped if low-risk or budget exhausted]
           → Routing (auto-apply / outreach / admin)
```

### 4.2 Stage 1 — Classifier

**Model**: `claude-haiku-4-5`
**Cost**: ~$0.0015 per call
**Input**: structured diff between current and proposed state
**Output**: JSON object

```json
{
  "risk_score": 0-100,
  "risk_level": "low|medium|high|critical",
  "category": "time_change|price_change|new_offering|removed_offering|discontinuation|venue_status|other",
  "plausibility_score": 0-100,
  "reasoning": "Short explanation",
  "verdict": "auto_apply|verify|queue_admin|reject"
}
```

**Risk rubric** (embed in system prompt):

| Change | Risk |
|---|---|
| Typo, formatting, description edit | low |
| Time shift ≤30 min | low |
| Price change <$1 | low |
| Time shift 30–60 min | medium |
| Price change $1–2 | medium |
| Adding new offering at typical price | medium |
| Day-of-week change | medium |
| Time shift 1–2 hours | high |
| Price change >$2 or >30% | high |
| New offering at unusual price | high |
| Time shift >2 hours | critical |
| Removing >50% of offerings | critical |
| Price drop >50% | critical |
| Venue marked discontinued / closed / no_happy_hour | critical |

**Verdict mapping**:
- `low` + positive trust → `auto_apply`
- `low` + neutral/unknown trust → `verify` (but cheap path: only check website)
- `medium` → `verify`
- `high` → `verify`, then route by result
- `critical` → always `queue_admin` (even if Stage 2 confirms — admin gets a green-light heads-up)

### 4.3 Stage 2 — Verifier

**Model**: `claude-sonnet-4-6` with tool use
**Cost**: ~$0.04 per call (typical: 8k input + 1k output across 2–4 fetches)
**Tools provided**:
- `fetch_url(url)` — internal wrapper around `fetch` with our user agent, robots.txt respect, 10s timeout
- `web_search(query)` — internal wrapper around a search API (start with simple Bing Web Search or DuckDuckGo HTML scrape; can upgrade later)

**Verification source priority** (instruct in system prompt):
1. Venue's own website (`venues.website_url`)
2. Google Business profile / Google Maps posts
3. Facebook business page posts (last 90 days)
4. Instagram grid
5. Yelp recent reviews mentioning happy hour
6. Other secondary sources

**Output**: JSON

```json
{
  "confirmed": true | false | null,
  "evidence": [
    {
      "source": "website|facebook|google|instagram|yelp|other",
      "url": "https://...",
      "snippet": "Exact text supporting the determination",
      "supports_change": true | false
    }
  ],
  "confidence": 0.0-1.0,
  "summary": "Short explanation"
}
```

**Hard rule baked into prompt**: Never invent evidence. If no source supports the change, return `confirmed: null`. Snippets must be quoted from actual fetched content.

### 4.4 Routing matrix

| Risk | Stage 2 result | Action |
|---|---|---|
| low | — | auto_apply |
| medium | confirmed | auto_apply |
| medium | unconfirmed | queue_outreach |
| medium | contradicted | reject + decrement trust |
| high | confirmed | auto_apply + flag for admin review |
| high | unconfirmed | queue_admin |
| high | contradicted | reject + decrement trust |
| critical | any | queue_admin (always) |
| any | budget exhausted | queue_admin with `budget_exhausted` flag |

### 4.5 Budget enforcement

Before every Stage 2 call:

```typescript
const monthCost = await db.select({
  total: sql<number>`coalesce(sum(cost_cents), 0)`
}).from(aiUsageLedger).where(
  and(
    eq(aiUsageLedger.month, firstOfCurrentMonth()),
    sql`stage IN ('classify', 'verify', 'reverify_cron')`
  )
);

const projectedCallCost = 5; // cents, conservative
const capCents = parseInt(process.env.ANTHROPIC_MONTHLY_CAP_CENTS ?? '2000');

if (monthCost + projectedCallCost > capCents) {
  // Skip Stage 2; route to admin queue with budget_exhausted status
}
```

**Default cap**: $20/mo (`ANTHROPIC_MONTHLY_CAP_CENTS=2000`)
**Warning threshold**: $15/mo — email admin
**Tiered behavior**:
- $0–15: normal
- $15–20: only run Stage 2 on `critical` submissions
- $20+: Stage 1 only; all Stage 2 calls queue to admin

Also set a workspace-level hard cap in the Anthropic console as a backstop.

### 4.6 Cost budget for steady-state Tacoma launch

Monthly target:

| Activity | Calls | Unit cost | Subtotal |
|---|---|---|---|
| Stage 1 classifications | ~500 | $0.0015 | $0.75 |
| Stage 2 verifications (organic) | ~150 | $0.04 | $6.00 |
| Cron re-verification (10/day × 30) | 300 | $0.04 | $12.00 |
| Buffer | — | — | $1.25 |
| **Total** | | | **~$20** |

If steady-state runs over, cut cron re-verification to 5/day.

One-time seed cost: ~$16 for full Tacoma enrichment (not counted against monthly).

### 4.7 Prompt templates

Prompts live in `/prompts/` as versioned Markdown files. Template skeleton:

**`/prompts/stage1-classifier.md`**:
```
# System
You are a content moderator for a happy hour aggregator. Given a proposed
change to a venue or happy hour entry, classify its risk level and recommend
an action. Never invent facts. Return only valid JSON matching the schema.

[Risk rubric table]
[JSON schema]
[Examples: 3 low, 3 medium, 3 high, 3 critical]

# User
Current state: {{current_jsonb}}
Proposed change: {{proposed_jsonb}}
Submitter trust score: {{trust_score}}
Submitter history: {{submission_count}} submissions, {{accuracy_rate}}% accuracy
```

**`/prompts/stage2-verifier.md`**:
```
# System
You verify proposed changes to happy hour data by checking the venue's own
website and social channels. You have two tools: fetch_url and web_search.

HARD RULES:
- Never invent evidence. Every quoted snippet must come from a fetched page.
- If no source supports the change, return confirmed: null.
- Check up to 4 sources, prioritizing: venue website > Google Business > Facebook > Instagram > Yelp.
- Stop early if you have high-confidence confirmation or contradiction.
- Respect robots.txt (fetch_url will refuse blocked pages).

[Output JSON schema]

# User
Venue: {{venue_name}}
Venue website: {{website_url}}
Venue other URL: {{other_url}}
Proposed change: {{diff_summary}}
```

Pin a content hash of each prompt in `ai_usage_ledger` so you can correlate behavior changes to prompt changes.

---

## 5. Anti-sabotage system

### 5.1 Layered defenses

1. **Submission rate limits**
   - Per fingerprint: 10/day, 30/week
   - Per IP: 20/day, 60/week
   - Per email (if provided): 10/day
   - Critical-flag rate: 2/day per fingerprint
2. **Captcha** (hCaptcha) on every submission form
3. **Honeypot field** in submission form (`<input name="website" hidden>` — bot fills → reject silently)
4. **Trust scoring** (see §3.11) — banned fingerprints' submissions are accepted but never applied; logged to study attack patterns
5. **Community flag corroboration** — critical changes need 5 confirms from distinct fingerprints OR AI verification OR admin approval
6. **Cross-venue anomaly detection** — weekly cron flags any /24 IP block submitting >3 critical-risk changes to different venues in 7 days (operator reviews manually)
7. **Reversal window** — every applied change is reversible from admin UI for 30+ days via `audit_log.before_jsonb`
8. **Source-URL requirement** — every applied change records `source_url`; users can click "where did this come from?"

### 5.2 Community flag UX

When a flag is opened on a venue/happy_hour, the row in the public table shows:

> ⚠ Someone reported this happy hour has been discontinued. Can you confirm?
> [Yes, it's gone] [No, still happening]

Voting requires a captcha and writes to `community_flags`. Vote counts visible. Once resolution criteria met, the row updates and the flag clears.

### 5.3 Generic vs. type-specific flags

`community_flags.flag_type` supports multiple types. The 5-vote rule is the default; each `flag_type` can have its own threshold defined in code (`/lib/trust/flagThresholds.ts`):

```typescript
export const FLAG_THRESHOLDS = {
  discontinued: { confirm: 5, deny: 3, expiry_days: 14 },
  closed: { confirm: 5, deny: 3, expiry_days: 14 },
  price_increase: { confirm: 3, deny: 2, expiry_days: 21 },
  hours_changed: { confirm: 3, deny: 2, expiry_days: 21 },
  other: { confirm: 5, deny: 3, expiry_days: 14 },
};
```

---

## 6. UI / UX

### 6.1 Design tokens

```css
:root {
  --bg-deep:      #1a1530;
  --bg-surface:   #2a1f3d;
  --bg-elevated:  #3d2a4a;
  --accent-warm:  #e8a04b;   /* prices, primary CTA, "happening now" */
  --accent-cool:  #8b6dd6;   /* links, secondary actions */
  --accent-hot:   #d65a7e;   /* flags, warnings, badges */
  --text-primary: #f4ebe0;
  --text-muted:   #a89bc4;
  --border:       #4a3a5e;
  --row-hover:    #3d2a4a;
  --row-promoted: rgba(232, 160, 75, 0.08);
}
```

**Typography**:
- Display / headings: a warm serif (e.g. Fraunces, DM Serif Display) — pick one and commit
- Body / UI: Inter or Geist
- Tabular numbers: enable `font-variant-numeric: tabular-nums` on the table

**Texture**: subtle SVG grain overlay at low opacity on backgrounds. Not film-grain heavy; just enough to avoid flat-color sterility.

### 6.2 Routes

| Route | Purpose |
|---|---|
| `/` | Redirect to default city (`/tacoma`) |
| `/[city]` | Main table view, all neighborhoods |
| `/[city]/[neighborhood-slug]` | Table pre-filtered to neighborhood |
| `/[city]/venue/[venue-slug]` | Single venue page (SEO) |
| `/submit/new-venue` | Add a venue you don't see |
| `/about` | Project explanation |
| `/faq` | How submissions work, anti-sabotage |
| `/for-restaurants` | Stub for v1, "claim coming soon" |
| `/admin` | Firebase-auth-gated admin queue |
| `/admin/audit` | Audit log viewer + revert tool |
| `/admin/budget` | AI spend dashboard |
| `/api/...` | JSON endpoints for submissions, flags, votes |

### 6.3 Main table

Layout:

```
[ Sticky filter bar ]
  Neighborhood chips (multi-select)  |  Day pills (Mon-Sun + "Today")
  Time filter: [ Happening now ] [ Custom: __ to __ ]
  Type/tag filters: [ Food ] [ Drink ] [ Cocktail ] [ Beer ] [ Wine ] [ Patio ] ... (chips)
  Sort: [ Start time ▼ ]   Search: [ ____________ ]

[ Table ]
  Venue | Neighborhood | Days | Start | End | Best deal | Tags | ⓘ
  -----------------------------------------------------------------
  Row...
  Row... (expanded inline → full offerings list, source link, "Suggest edit", "Get directions")
```

**Mobile**: filter bar collapses into a "Filters" button; table becomes a card list with the same sort/filter controls accessible.

**Promoted rows** (`promotion_tier != 'none'`): subtle gold left border + `--row-promoted` background. Never sort-jumped; sort respects user choice. (Pinning means top-of-section, applied only when sort = default.)

**Help-wanted rows**: where `data_completeness = 'stub'`, render with muted text and CTA: "Does this place have a happy hour? Help us add it →"

**"Get directions" button per row**:
```typescript
const isApple = /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
const url = isApple
  ? `https://maps.apple.com/?q=${encodeURIComponent(address)}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
```

### 6.4 Submission flow

1. User clicks pencil icon on any editable cell (price, time, etc.) OR "Suggest edit" on expanded row OR "Add a venue" CTA
2. Modal opens with the field(s) pre-filled, current values shown alongside proposed
3. Optional fields: source URL ("Where did you see this?"), email ("If you want us to email if there's an issue")
4. hCaptcha
5. Honeypot
6. Submit → `POST /api/submissions`
7. Response: "Thanks — AI will review and most changes apply within 24 hours. You can [follow this link] to check status." (Status page is a public URL keyed by submission ID, no auth.)

**For critical changes** (e.g. "this place no longer does happy hour"), the form is a separate, higher-friction flow:
- Confirmation prompt: "This is a major change. Are you sure?"
- Required: reason field with minimum length
- Required: source URL OR detailed explanation
- After submission: "We'll review and corroborate. The row will be flagged for community input."

### 6.5 SEO

- Per-venue page renders SSR with full offering list, hours, address, directions link
- Schema.org JSON-LD: `Restaurant` + nested `Event` per happy hour
- Per-neighborhood landing page: SSR-rendered with hand-written intro paragraph (50–100 words per neighborhood) + the filtered table
- `sitemap.xml` auto-generated; includes city, neighborhood, and venue routes
- `robots.txt` allows all (no admin paths exposed)
- OG image per venue generated at request time (`@vercel/og` or `satori` standalone)

### 6.6 About / FAQ content (drafts to write before launch)

- "How is this data collected?" → AI-assisted with human review
- "How do I submit a change?" → walk through the flow
- "How do you prevent fake submissions?" → trust score, AI verification, community flags
- "I'm a restaurant — how do I correct my listing?" → for now, use the regular form; claiming coming soon
- "Why is some data missing?" → we'd rather show nothing than guess

---

## 7. Tacoma launch data

### 7.1 Neighborhood polygons — primary source

**Source**: City of Tacoma Open Data — Neighborhood Council Districts
**URL**: https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about
**Format**: GeoJSON download available; 8 official council districts
**License**: Public domain (City of Tacoma Open Data)

The 8 Neighborhood Council Districts of Tacoma:
1. Central
2. New Tacoma (covers Downtown)
3. North End
4. Northeast
5. South End
6. South Tacoma
7. West End
8. Eastside

### 7.2 Vernacular sub-neighborhoods (locals' names)

These are the names locals actually use. They overlap with and subdivide the official council districts. Store as `neighborhoods` rows with `parent_id` referencing the council district:

| Vernacular | Council Parent | Notes |
|---|---|---|
| Downtown | New Tacoma | |
| Dome District | New Tacoma | Near Tacoma Dome / Freighthouse Sq |
| Stadium District | North End | |
| North Slope | North End | Historic district |
| Old Town | North End | |
| Proctor District | North End | N 26th & Proctor |
| 6th Ave | North End / Central (crosses) | Business corridor |
| Three Bridges | North End | Small |
| UPS Neighborhood | North End | Around U of Puget Sound |
| Ruston / Pt Defiance | North End (adjacent to Ruston city) | |
| Hilltop | Central | |
| Lincoln District | South End / Central | |

Polygons for vernacular sub-neighborhoods aren't in the official GIS. Approach:
- Start with the 8 council polygons as canonical
- Manually digitize 4-6 highest-value vernacular sub-neighborhoods (Downtown, Stadium, Proctor, 6th Ave, Hilltop, Old Town) using bounding box estimates from public sources
- Tag them with `source: "manually digitized"` and `parent_id` pointing to the council district
- Document the manual ones so the next city can copy the approach

Filter chip UX shows the vernacular names first (locals' mental model), with the council districts available as a fallback option.

### 7.3 Venue seed pipeline

**Stage A — Discovery**

Script: `scripts/seed-discover-tacoma.ts`

Sources:
1. Google Places API Nearby Search: `type=bar` and `type=restaurant` within Tacoma bounding box, paginated. Stores `name`, `place_id`, `address`, `lat`, `lng`, `phone`, `website` into `seed_candidates`.
2. Curated source URLs to scrape candidate names from (AI-assisted parsing → match against Google Places):
   - https://wanderlog.com/list/geoCategory/1568034/best-spots-for-happy-hour-in-tacoma
   - https://seattletravel.com/best-tacoma-happy-hours/
   - https://ultimatehappyhours.com/location/tacoma/
   - https://dropt.beer/insights/tacomas-happy-hour-havens-your-ultimate-guide-to-unwinding/
   - Yelp "Happy Hour Bars Tacoma" page (first 3 pages of results)

Estimated output: 300–500 candidate venues.

**Stage B — Enrichment**

Script: `scripts/seed-enrich-candidates.ts`

For each candidate, run the same Stage 2 verifier (or a near-identical seed variant) with task: "Find this venue's happy hour information from their own channels."

Three outcomes:
- `confirmed_hh`: insert full venue + happy_hours + offerings, `data_completeness = 'complete'`
- `no_hh_found`: insert venue with `status = 'active'`, `data_completeness = 'stub'`, no happy_hours rows (renders as help-wanted on site)
- `no_hh_explicit`: insert venue with `status = 'no_happy_hour'`, hidden from default view

Estimated one-time cost: 400 × $0.04 = ~$16.

**Stage C — Manual review**

Operator spot-checks first 50 confirmed entries. Builds a checklist of common AI mistakes for prompt refinement.

### 7.4 Known Tacoma venues to verify in seed (priority list)

From research, these are confirmed-active happy hour spots in Tacoma — they should appear in the first seed pass:

- Boom Boom Room (Stadium)
- Holy Moly Bar
- The Old Hang Out
- Busy Body
- Top of Tacoma Bar
- Bar Rosa
- West 122
- Proof
- Matador Tacoma (Downtown)
- Cooper's Food And Drink
- Dirty Oscar's Annex
- En Rama
- Doyle's Public House
- Magoo's
- Bob's Java Jive
- Hank's Pizza & Beer
- Home Plate Tavern
- UP Station Bar & Grill
- Meconi's Tacoma Pub
- The Office Bar & Grill
- Peaks and Pints (Downtown)
- The Swiss
- The Rock (pizza)
- Brewer's Row
- Katie Downs
- Bar Bistro (6th Ave / North End)
- The Swami's (North End)
- Dorky's Bar & Grill

If a seed run misses any of these, the operator manually adds and re-runs Stage 2 enrichment on them.

---

## 8. DNS, email, and infrastructure setup

### 8.1 Domain and DNS

1. happyhourfriends.com already owned — verify at registrar
2. Set Cloudflare as DNS provider (free plan)
3. Update nameservers at registrar to Cloudflare's
4. In Cloudflare:
   - A record `@` → DO droplet IP
   - A record `www` → DO droplet IP
   - Enable Email Routing
   - Route: `help@happyhourfriends.com` → operator's personal email
   - Route: `noreply@happyhourfriends.com` → bin or operator
   - Catch-all → operator
5. Add SPF, DKIM, DMARC records per Resend's setup instructions

### 8.2 DigitalOcean

- Droplet: SFO3, basic tier (start small, $12-24/mo)
- Managed Postgres: SFO3, basic plan with 7-day PITR backups ($15/mo minimum)
- Enable PostGIS extension on the DB:
  ```sql
  CREATE EXTENSION IF NOT EXISTS postgis;
  ```
- Firewall: only 22 (SSH), 80, 443 open; Postgres access only from droplet's private IP

### 8.3 Production env vars

```
DATABASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_CLASSIFIER=claude-haiku-4-5
ANTHROPIC_MODEL_VERIFIER=claude-sonnet-4-6
ANTHROPIC_MONTHLY_CAP_CENTS=2000
ANTHROPIC_WARNING_THRESHOLD_CENTS=1500
GOOGLE_PLACES_API_KEY=
HCAPTCHA_SITE_KEY=
HCAPTCHA_SECRET_KEY=
RESEND_API_KEY=
RESEND_FROM=help@happyhourfriends.com
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
ADMIN_EMAIL=
SENTRY_DSN=
POSTHOG_KEY=
NEXT_PUBLIC_SITE_URL=https://happyhourfriends.com
```

---

## 9. Build phases (acceptance criteria)

### Phase 0 — Foundation (week 1)
- [ ] Next.js 15 + TypeScript + Tailwind + shadcn/ui scaffold
- [ ] Drizzle schema for all tables in §3 with migrations
- [ ] PostGIS extension enabled, GIST index on neighborhoods.polygon
- [ ] DO droplet + managed Postgres provisioned, deploy pipeline working
- [ ] Cloudflare DNS + email forwarding live
- [ ] Firebase Auth admin login working at `/admin`
- [ ] Sentry + PostHog wired
- [ ] Design tokens applied; empty home page renders palette correctly
- [ ] Import Tacoma neighborhood council districts (GeoJSON → PostGIS)

### Phase 1 — Read-only table (week 2)
- [ ] `/tacoma` route with sortable/filterable table reading from seeded data
- [ ] Manual seed of ~30 venues via SQL (no AI yet)
- [ ] Per-venue page at `/tacoma/venue/[slug]`
- [ ] Per-neighborhood page at `/tacoma/[neighborhood-slug]`
- [ ] Sitemap, robots.txt, OG images, JSON-LD
- [ ] Mobile responsive
- [ ] Get directions deep links work on both platforms
- [ ] About / FAQ pages live

### Phase 2 — Submissions + manual admin review (week 3)
- [ ] Anonymous submission flow with hCaptcha + honeypot
- [ ] Submission stored in `edit_submissions` with status `pending`
- [ ] Admin queue at `/admin` shows pending submissions with diff view
- [ ] Admin can apply, reject, or edit-then-apply
- [ ] Audit log populated on every apply
- [ ] Revert button works from `/admin/audit`
- [ ] Public submission status page

### Phase 3 — Stage 1 classifier (week 4)
- [ ] Prompt template version-controlled in `/prompts/`
- [ ] Submission triggers Stage 1 via pg-boss job
- [ ] Risk level + verdict written to `edit_submissions`
- [ ] Low-risk verdicts auto-apply
- [ ] Medium/high/critical queue for now
- [ ] `ai_usage_ledger` records every call
- [ ] `/admin/budget` shows current month spend

### Phase 4 — Stage 2 verifier (week 5)
- [ ] Stage 2 prompt + tool definitions
- [ ] `fetch_url` tool with user agent, 10s timeout, robots.txt check
- [ ] `web_search` tool wired
- [ ] Stage 2 runs for medium/high after Stage 1
- [ ] Verification results auto-route per §4.4
- [ ] Budget cap enforced — calls skip Stage 2 cleanly when exhausted
- [ ] Warning email at $15 threshold

### Phase 5 — Community flags + anti-sabotage (week 6)
- [ ] Flag flow UI on rows
- [ ] `community_flags` voting endpoint with captcha + rate limit
- [ ] Resolution cron job runs daily
- [ ] Submitter trust scoring updates after change outcomes
- [ ] Rate limits enforced at API layer
- [ ] Anomaly detection cron flags suspicious patterns to admin email

### Phase 6 — Tacoma seed (week 6–7)
- [ ] Stage A discovery script run
- [ ] Stage B enrichment script run (one-time ~$16 cost)
- [ ] Manual spot-check of first 50 confirmed venues
- [ ] Help-wanted rows visible on site for stubs
- [ ] Soft launch announcement

### Phase 7 — Re-verification + monetization scaffold (week 8+)
- [ ] Daily cron re-verifies 10 oldest venues
- [ ] `last_verified_at` updates
- [ ] Promotion tier UI styling implemented (no payment integration yet)
- [ ] Admin can manually set promotion tier and dates
- [ ] `/for-restaurants` page explains claiming/promotion (still no payment)

---

## 10. Open items for operator (you) before agent starts

These need a decision or input before / during build:

1. **Google Places API key** — create one in GCP console; budget alert at $50/mo
2. **hCaptcha site + secret key** — register at hcaptcha.com
3. **Resend account** — register, add domain, paste DKIM records into Cloudflare
4. **Firebase project** — create, enable Auth (Google provider), add your email as admin
5. **Anthropic console** — set workspace spend limit to $30/mo as backstop
6. **Sentry + PostHog + UptimeRobot** — create free accounts
7. **DO account ready** — droplet + managed Postgres provisioned at SFO3
8. **Domain DNS moved to Cloudflare** before agent runs Phase 0
9. **Choose serif font for headings** — recommend Fraunces (variable, free, warm)
10. **Decide grain texture** — agent will use a simple SVG noise filter unless you provide an asset

---

## 11. Things explicitly deferred to post-v1

Tracked so they don't get sneaked into v1 scope:

- React Native (Expo) mobile app sharing the same API
- User accounts (Firebase email/social) for trusted contributors
- Restaurant claiming flow with verified-owner badge
- Promotion payments (Stripe) — schema is ready, UI is partial, payment integration is deferred
- Embedded map view (MapLibre + OSM tiles)
- Photos beyond Google Places thumbnails
- Reviews / ratings
- Multi-language
- Public read-only API
- Expansion to second city (validates GIS import pipeline)
- Email digests for users who provided their email

---

## 12. Reference URLs

**Tacoma data**:
- Neighborhood Council Districts (ArcGIS): https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about
- Tacoma Open Data portal: https://data.cityoftacoma.org/
- Neighborhood Business Districts (city.gov): https://tacoma.gov/government/departments/community-and-economic-development/neighborhood-business-districts/

**Tech docs**:
- Next.js: https://nextjs.org/docs
- Drizzle: https://orm.drizzle.team/docs/overview
- pg-boss: https://github.com/timgit/pg-boss
- Drizzle + PostGIS: https://orm.drizzle.team/docs/extensions/pg#postgis (use `customType` for `geometry`)
- shadcn/ui: https://ui.shadcn.com/
- Anthropic SDK: https://docs.claude.com/en/api/overview
- Anthropic tool use: https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview
- Firebase Auth (server SDK in Next.js): https://firebase.google.com/docs/auth/admin
- Resend: https://resend.com/docs
- hCaptcha: https://docs.hcaptcha.com/
- DigitalOcean Managed Postgres + PostGIS: https://docs.digitalocean.com/products/databases/postgresql/
- Cloudflare Email Routing: https://developers.cloudflare.com/email-routing/

**Seed source pages** (for the discovery script):
- https://wanderlog.com/list/geoCategory/1568034/best-spots-for-happy-hour-in-tacoma
- https://seattletravel.com/best-tacoma-happy-hours/
- https://ultimatehappyhours.com/location/tacoma/
- https://dropt.beer/insights/tacomas-happy-hour-havens-your-ultimate-guide-to-unwinding/
- https://www.yelp.com/search?find_desc=Happy+Hour+Bars&find_loc=Tacoma,+WA

---

## 13. Handoff notes to the implementation agent

- **Read this PRD end-to-end before writing code.** Don't skim §3 (schema) or §4 (AI pipeline) — they're the load-bearing parts.
- **Phase 0 is foundation. Don't skip to Phase 3 because it's the "interesting" part.** The schema + neighborhood polygons + budget ledger need to exist before anything else can be built on them.
- **Never hallucinate data.** If you don't have a value for a venue field, write `null`, not a guess. If you don't have happy hour info for a venue, don't create `happy_hours` rows for it.
- **Pin prompts.** Every change to a prompt template gets a new file or commit, and `ai_usage_ledger` records which prompt version was used. This is debuggability.
- **Source URLs are required.** Every applied change carries a source. No exceptions, including AI-applied changes.
- **Don't deduplicate aggressively at seed time.** Two listings that look like the same venue may genuinely be a chain. Use `google_place_id` as the unique key, not name.
- **Day-of-week is 1=Monday, 7=Sunday.** This is not negotiable; it's the SQL standard.
- **Times are local to the venue.** Render "happening now" by converting *the current moment* into the venue's timezone, not by trying to normalize stored times to UTC.
- **`crosses_midnight` is a computed boolean.** Add it as a generated column or compute it in app code on insert; either way, `end_time < start_time` means it crosses.
- **Ask before assuming.** If something in this PRD is ambiguous or conflicts with itself, stop and ask. Don't paper over with an assumption.

End of PRD.

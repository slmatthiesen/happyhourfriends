/**
 * jsonLdMenu — read happy-hour menus out of schema.org JSON-LD (`Menu` / `MenuSection`
 * / `MenuItem` / `Offer`) that restaurant CMSs embed in `<script type="application/
 * ld+json">`.
 *
 * Why this exists (Spencer's, 2026-06-13): the full HH menu — exact names, prices,
 * descriptions — ships as JSON-LD, but `stripHtml` drops `<script>` and
 * `harvestScriptText` skips the bare-token prices ("12.00" looks like a JSON id), so the
 * model never saw it and stored a stray visible "$42" entrée at confidence 1.0. This
 * reconstructs the name↔price pairing the structured data already has, deterministically
 * and for free. See docs/extraction-miss-diagnosis-2026-06-13.md (fix bucket 0).
 *
 * v1 targets HH-NAMED menus/sections (name or description matches HH_RE). Generic menus
 * are left to the existing text path — flooding the model with a 100-item dinner menu is
 * the opposite of the precision win we're after.
 */
import { HH_RE } from "@/lib/places/hhText";

export interface JsonLdMenuItem {
  name: string;
  description: string | null;
  priceCents: number | null;
}

export interface JsonLdMenuSection {
  /** The Menu/MenuSection `name` (e.g. "Happy Hour"), or null. */
  name: string | null;
  description: string | null;
  /** name or description matched HH_RE. */
  isHappyHour: boolean;
  items: JsonLdMenuItem[];
}

/** Cap the emitted item list so a pathological menu can't blow the payload budget. */
const MAX_ITEMS = 60;

/** "12.00" | "12" | 12 | "$12.50" → cents; null/empty/zero/garbage → null. */
function parsePriceCents(price: unknown): number | null {
  if (price == null) return null;
  const n = typeof price === "number" ? price : parseFloat(String(price).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** schema.org `offers` is an Offer or an array of them. Take the first parseable price
 *  (Spencer's Spinach Dip lists $12 then a $5 "Add crab" — we want $12). */
function priceFromOffers(offers: unknown): number | null {
  if (offers == null) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    const cents = parsePriceCents((o as { price?: unknown })?.price);
    if (cents != null) return cents;
  }
  return null;
}

function itemFromNode(node: Record<string, unknown>): JsonLdMenuItem | null {
  const name = typeof node.name === "string" ? node.name.trim() : null;
  if (!name) return null;
  return {
    name,
    description: typeof node.description === "string" ? node.description.trim() : null,
    priceCents: priceFromOffers(node.offers),
  };
}

/** Recursively collect every node carrying `hasMenuItem` (a Menu or MenuSection),
 *  wherever it sits (Restaurant→hasMenu→Menu→hasMenuSection→…, @graph arrays, etc.).
 *
 *  HH-ness PROPAGATES from an ancestor: Spencer's wraps a Menu named "Happy Hour" around
 *  a "Happy Hour" food section AND a "Drink Specials" section — the drinks belong to the
 *  HH menu even though their own section name doesn't say so. So a section is HH if its
 *  own name/description matches HH_RE, or any ancestor menu's did. */
function collectSections(root: unknown): JsonLdMenuSection[] {
  const sections: JsonLdMenuSection[] = [];
  const seen = new Set<object>();

  const walk = (node: unknown, ancestorHH: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, ancestorHH));
      return;
    }
    const obj = node as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : null;
    const description = typeof obj.description === "string" ? obj.description.trim() : null;
    const inHH = ancestorHH || HH_RE.test(`${name ?? ""} ${description ?? ""}`);

    if (obj.hasMenuItem != null) {
      const raw = Array.isArray(obj.hasMenuItem) ? obj.hasMenuItem : [obj.hasMenuItem];
      const items = raw
        .map((i) => (i && typeof i === "object" ? itemFromNode(i as Record<string, unknown>) : null))
        .filter((i): i is JsonLdMenuItem => i !== null);
      if (items.length) sections.push({ name, description, isHappyHour: inHH, items });
    }
    for (const v of Object.values(obj)) walk(v, inHH);
  };

  walk(root, false);
  return sections;
}

/** Pull every `<script type="application/ld+json">` body from a page. */
function extractLdJsonBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!/application\/ld\+json/i.test(m[1])) continue;
    out.push(m[2].trim());
  }
  return out;
}

/** All Menu/MenuSection nodes found in the page's JSON-LD. Tolerant: a block that fails
 *  to parse is skipped, never thrown. */
export function parseJsonLdMenuSections(html: string): JsonLdMenuSection[] {
  const sections: JsonLdMenuSection[] = [];
  for (const raw of extractLdJsonBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    sections.push(...collectSections(parsed));
  }
  return sections;
}

/** "$19.00" | "$19" | "19.00" → cents, from a raw regex-matched price substring. */
function parseDollarMatch(raw: string): number | null {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/**
 * A site's JSON-LD schema markup and its visible rendered menu are two independently
 * edited surfaces — a restaurant can update one and forget the other (Lilac Montecito,
 * 2026-07-06: visible menu moved Baked Oysters to $24, JSON-LD still said $19; every
 * future re-extraction kept reading the stale structured price since a retry never
 * touches the site). Look for THIS item's name in the plain visible text and, if a price
 * appears within a short window after it and disagrees with the JSON-LD price, trust the
 * visible text instead — it's the surface a customer (and, in practice, the site owner)
 * actually looks at. No visible mention, or only the same price → JSON-LD stands as-is.
 */
function reconcilePriceWithVisibleText(item: JsonLdMenuItem, visibleText: string): JsonLdMenuItem {
  if (item.priceCents == null || !visibleText) return item;
  const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}[^$]{0,80}?\\$\\s?(\\d[\\d,]*(?:\\.\\d{2})?)`, "i").exec(visibleText);
  if (!match) return item;
  const visiblePriceCents = parseDollarMatch(match[1]);
  if (visiblePriceCents == null || visiblePriceCents === item.priceCents) return item;
  return { ...item, priceCents: visiblePriceCents };
}

/**
 * Clean text for the extractor's payload: the happy-hour menu's items with their exact
 * names and prices, paired the way the structured data already pairs them. Empty string
 * when the page has no HH-named menu in its JSON-LD (the common case — costs nothing).
 *
 * `visibleText` (the same page's stripped rendered text, if available) is used to catch
 * and correct a JSON-LD price that has drifted stale from what the page actually shows —
 * see reconcilePriceWithVisibleText. Purely a $0 string cross-check, no extra fetch/call.
 */
export function harvestJsonLdMenu(html: string, visibleText?: string): string {
  const hh = parseJsonLdMenuSections(html).filter((s) => s.isHappyHour && s.items.length > 0);
  if (hh.length === 0) return "";

  const lines = ["[Happy-hour menu items from this page's structured data (schema.org JSON-LD):]"];
  let count = 0;
  for (const s of hh) {
    const header = [s.name, s.description].filter(Boolean).join(" — ");
    if (header) lines.push(header);
    for (const raw of s.items) {
      if (count >= MAX_ITEMS) break;
      count++;
      const it = visibleText ? reconcilePriceWithVisibleText(raw, visibleText) : raw;
      const price = it.priceCents != null ? ` — $${(it.priceCents / 100).toFixed(2)}` : "";
      const desc = it.description ? ` (${it.description})` : "";
      lines.push(`- ${it.name}${price}${desc}`);
    }
  }
  return lines.join("\n");
}

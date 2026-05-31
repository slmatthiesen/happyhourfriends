/**
 * Persisted state for a resumable batch enrichment run. One JSON file per
 * in-flight batch under .enrich-batch/ (gitignored). Holds the batch id plus the
 * per-candidate Google Place Details context needed to write results at collect
 * time — so a crashed run can resume against the already-submitted batch instead
 * of re-paying for prep + extraction.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = join(process.cwd(), ".enrich-batch");

/** Resolved, non-AI context for one candidate (custom_id === candidate id). */
export interface PrepContext {
  candidateId: string;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  googlePlaceId: string | null;
  siteUrl: string | null;
  phone: string | null;
  priceLevel: number | null;
  photoName: string | null;
  primaryType: string | null;
  types: string[] | null;
}

export interface BatchState {
  batchId: string;
  citySlug: string;
  cityId: string;
  contexts: Record<string, PrepContext>;
}

function stateFilePath(citySlug: string, batchId: string): string {
  return join(STATE_DIR, `${citySlug}-${batchId}.json`);
}

export function writeBatchState(state: BatchState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFilePath(state.citySlug, state.batchId), JSON.stringify(state, null, 2));
}

/** Return the first un-collected batch state for a city, or null. */
export function findBatchState(citySlug: string): BatchState | null {
  let files: string[];
  try {
    files = readdirSync(STATE_DIR);
  } catch {
    return null;
  }
  const match = files.find((f) => f.startsWith(`${citySlug}-`) && f.endsWith(".json"));
  if (!match) return null;
  return JSON.parse(readFileSync(join(STATE_DIR, match), "utf8")) as BatchState;
}

export function deleteBatchState(citySlug: string, batchId: string): void {
  try {
    rmSync(stateFilePath(citySlug, batchId));
  } catch {
    /* already gone */
  }
}

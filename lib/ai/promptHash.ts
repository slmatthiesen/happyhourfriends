import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(process.cwd(), "prompts");

export interface LoadedPrompt {
  name: string;
  content: string;
  /** sha256 (first 16 hex chars) of the file. Recorded in ai_usage_ledger.prompt_hash
   *  so behavior changes can be correlated to prompt changes (PRD §4.7). */
  hash: string;
}

export function loadPrompt(fileName: string): LoadedPrompt {
  const content = readFileSync(join(PROMPTS_DIR, fileName), "utf8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return { name: fileName, content, hash };
}

/** Split a `# System` / `# User` markdown prompt into its two sections. */
export function splitPrompt(content: string): { system: string; user: string } {
  const userIdx = content.indexOf("\n# User");
  if (userIdx === -1) return { system: content.trim(), user: "" };
  const system = content.slice(0, userIdx);
  const user = content.slice(userIdx + "\n# User".length);
  // Drop a leading frontmatter block from the system half if present.
  const system2 = system.replace(/^---[\s\S]*?---\n/, "");
  return { system: system2.trim(), user: user.trim() };
}

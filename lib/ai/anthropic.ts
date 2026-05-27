import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared, lazily-constructed Anthropic client. Constructed on first use so that
 * importing AI modules during `next build` (or in code paths that never call the
 * API) does not require ANTHROPIC_API_KEY to be set.
 */
let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  client = new Anthropic({ apiKey });
  return client;
}

/** Token counts returned by a model call, used to price the call for the ledger. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Strip a ```json fence (or stray prose) and parse the first JSON object in a
 * model response. Both stage prompts instruct the model to return bare JSON, but
 * this is defensive against fences slipping through.
 */
export function parseJsonResponse<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in model response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

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

let glmClient: Anthropic | undefined;

/** GLM (Zhipu) speaks the Anthropic wire protocol via z.ai's compat endpoint, so the same
 *  SDK + message shapes work with only the baseURL + key swapped. Free Haiku-tier model. */
function glm(): Anthropic {
  if (glmClient) return glmClient;
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) throw new Error("GLM_API_KEY is not set");
  const baseURL = process.env.GLM_BASE_URL ?? "https://api.z.ai/api/anthropic";
  glmClient = new Anthropic({ apiKey, baseURL });
  return glmClient;
}

/** True for GLM model ids that read text only (no vision) — image/PDF blocks must be
 *  stripped before such a call or the request 400s on the unsupported block. The vision
 *  GLMs (glm-4.5v / glm-4.6v) are excluded so they keep their image blocks. */
export function isTextOnlyGlmModel(model: string): boolean {
  return /^glm/i.test(model) && !/glm-4\.\dv/i.test(model);
}

/** Pick the client a model id belongs to. `glm-*` → GLM (z.ai), everything else → Anthropic.
 *  Lets a single env model override (e.g. ANTHROPIC_MODEL_EXTRACTOR=glm-4.5-flash) route a
 *  whole stage to GLM without touching its call shape. */
export function clientForModel(model: string): Anthropic {
  return /^glm/i.test(model) ? glm() : anthropic();
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

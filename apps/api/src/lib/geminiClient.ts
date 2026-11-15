import { z } from 'zod';

/**
 * `GEMINI_MODEL_ID` (§14) — the one value to change when swapping Gemini
 * models.
 *
 * Was `gemini-2.5-flash`, which Google retired for new API consumers: it
 * is still listed by `GET /v1beta/models` but every `generateContent`
 * call against it answers 404 `"no longer available to new users"`. That
 * failure was invisible from the UI — `callGeminiStructured` correctly
 * degraded to `{ ok: false }` and both callers correctly fell back, so
 * the symptom checker just quietly stopped pre-filling the checklist and
 * every described-in-text report got flagged for manual review.
 *
 * Deliberately a pinned version, not the `gemini-flash-latest` alias.
 * The alias moves under us — the same silent-degradation class of bug,
 * only on Google's schedule instead of ours — and it answered 503 under
 * load when tested here, while a pin answered 200.
 *
 * A `-lite` model, deliberately. `gemini-3.5-flash` was tried first and
 * measured at 14–30s per call, because it reasons before answering; that
 * blows both `GEMINI_REQUEST_TIMEOUT_MS` (5s) and the browser's
 * `API_CLIENT_TIMEOUT_MS` (8s), so every call timed out and AI assist
 * stayed off. This model measured 1.3–1.5s typical for the same request.
 *
 * Reasoning quality is not what this call needs: under ADR-004 the model
 * only maps free text onto a boolean checklist, and the deterministic
 * engine — never the model — makes the triage decision. Extraction
 * accuracy was spot-checked against a multi-symptom description and was
 * correct on every field, including the negative ones.
 */
export const GEMINI_MODEL_ID = 'gemini-2.0-flash';
/** `GEMINI_REQUEST_TIMEOUT_MS` (§14) — bounds a hung Gemini call inside the Worker's request budget. */
export const GEMINI_REQUEST_TIMEOUT_MS = 5000;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface CallGeminiStructuredOptions<T> {
  apiKey: string;
  /** Fixed system instruction supplied by the caller as a constant — never interpolated from user input. */
  systemInstruction: string;
  /** Untrusted free text — wrapped in a delimited data block, never role-elevated. */
  userContent: string;
  /** Validates and shapes the model's structured output; also generates the API-facing JSON schema. */
  responseSchema: z.ZodType<T>;
  signal?: AbortSignal;
}

export type CallGeminiStructuredResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * Gemini's `responseSchema` accepts a restricted subset of OpenAPI 3.0
 * Schema, NOT full JSON Schema. `z.toJSONSchema()` emits at least two keys
 * it rejects outright with a 400: `$schema` (draft identifier) and
 * `additionalProperties` (which zod always sets to `false` for a strict
 * object).
 *
 * This was sending an invalid schema on every call since the feature
 * shipped, so AI assist has never actually worked — the failure was
 * invisible because `callGeminiStructured` degrades to `{ ok: false }` by
 * design and both callers correctly fall back. It only became findable
 * once `symptom-check.ts` started logging the reason.
 *
 * Recursive: nested objects and array `items` carry the same keys and are
 * rejected the same way. Unknown keys are dropped rather than passed
 * through, so a future zod version emitting some new annotation cannot
 * silently reintroduce this.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
]);

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(toGeminiSchema);
  }
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) {
      continue;
    }
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      const properties: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = toGeminiSchema(child);
      }
      result[key] = properties;
    } else if (key === 'items') {
      result[key] = toGeminiSchema(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Strips HTML/markdown/control characters before the untrusted text ever reaches the prompt. */
function sanitizeUserContent(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`#[\]()]/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
    .trim();
}

/**
 * Every §5.4 prompt-injection defense lives in this one function so no
 * route can forget one: fixed system instruction, a clearly delimited
 * untrusted-data block, sanitized input, structured output always
 * enforced, a bounded timeout, and the caller's own zod schema
 * re-validating the response before it is ever trusted. Never throws,
 * never returns unvalidated model output (ADR-004 — the LLM's output is
 * never the decision, only structured input to a deterministic engine
 * downstream).
 */
export async function callGeminiStructured<T>(
  options: CallGeminiStructuredOptions<T>
): Promise<CallGeminiStructuredResult<T>> {
  const { apiKey, systemInstruction, userContent, responseSchema, signal } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());

  try {
    const sanitized = sanitizeUserContent(userContent);
    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `--- BEGIN UNTRUSTED USER DATA ---\n${sanitized}\n--- END UNTRUSTED USER DATA ---` }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(z.toJSONSchema(responseSchema, { target: 'draft-07' })),
        },
      }),
    });

    if (!response.ok) {
      return { ok: false, reason: `gemini_http_${response.status}` };
    }

    const payload = await response.json().catch(() => undefined);
    const text = (payload as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | undefined)
      ?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text !== 'string') {
      return { ok: false, reason: 'gemini_malformed_response' };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'gemini_invalid_json' };
    }

    const validated = responseSchema.safeParse(parsedJson);
    if (!validated.success) {
      return { ok: false, reason: 'gemini_schema_mismatch' };
    }

    return { ok: true, data: validated.data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'gemini_timeout' };
    }
    return { ok: false, reason: 'gemini_request_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

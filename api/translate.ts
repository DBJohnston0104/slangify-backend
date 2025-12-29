// api/translate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type TranslateMode = "plain" | "professional" | "parent";

type TranslateRequest = {
  text: string;
  deviceId?: string;
  mode?: TranslateMode;
};

type TranslateSuccess = {
  output: string;
  cached?: boolean;
};

type TranslateError = {
  error: string;
  code:
    | "METHOD_NOT_ALLOWED"
    | "VALIDATION_ERROR"
    | "RATE_LIMIT"
    | "KILL_SWITCH"
    | "MISSING_API_KEY"
    | "UPSTREAM_ERROR"
    | "INTERNAL_ERROR";
  retryAfterSeconds?: number;
  upstreamStatus?: number;
  details?: string; // safe diagnostic (no secrets)
};

// -------------------- Config --------------------
const MAX_CHARS = 80;
const MAX_WORDS = 20;
const MAX_OUTPUT_TOKENS = 60;

// Serverless note: in-memory state is best-effort (may reset between invocations)
const RATE_LIMIT_MAX_PER_HOUR = 10;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// If you want to be extra safe on availability, use gpt-4o-mini.
const OPENAI_MODEL = "gpt-4o-mini";

// Optional kill switch: set DISABLE_TRANSLATION="true" in Vercel env vars to hard stop.
const KILL_SWITCH_ENV = process.env.DISABLE_TRANSLATION === "true";

// -------------------- Best-effort in-memory stores --------------------
const rateLimitByKey = new Map<
  string,
  { count: number; windowStartMs: number }
>();
const cache = new Map<string, { output: string; createdMs: number }>();

// -------------------- Helpers --------------------
function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function countWords(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function validateInput(text: string): string | null {
  if (!text || !text.trim()) return "Please enter text to translate.";
  if (text.length > MAX_CHARS)
    return `Please keep it under ${MAX_CHARS} characters.`;
  const words = countWords(text);
  if (words > MAX_WORDS) return `Please keep it under ${MAX_WORDS} words.`;
  return null;
}

function getClientKey(req: VercelRequest, deviceId?: string): string {
  // Prefer deviceId if provided; else fallback to IP.
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    (req.socket?.remoteAddress ?? "unknown");
  return deviceId?.trim() ? `device:${deviceId.trim()}` : `ip:${ip}`;
}

function checkRateLimit(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;

  const entry = rateLimitByKey.get(key);
  if (!entry || now - entry.windowStartMs >= windowMs) {
    rateLimitByKey.set(key, { count: 1, windowStartMs: now });
    return { ok: true };
  }

  if (entry.count >= RATE_LIMIT_MAX_PER_HOUR) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowMs - (now - entry.windowStartMs)) / 1000)
    );
    return { ok: false, retryAfterSeconds };
  }

  entry.count += 1;
  rateLimitByKey.set(key, entry);
  return { ok: true };
}

function readJsonBody(req: VercelRequest): TranslateRequest {
  // Vercel can provide req.body as object OR string.
  const raw = req.body as unknown;
  if (typeof raw === "string") return JSON.parse(raw) as TranslateRequest;
  return raw as TranslateRequest;
}

function send(res: VercelResponse, status: number, payload: TranslateSuccess | TranslateError) {
  res.setHeader("Content-Type", "application/json");
  // Optional: allow your app to call cross-origin if needed
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.status(status).json(payload);
}

// -------------------- Handler --------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    });
  }

  try {
    if (KILL_SWITCH_ENV) {
      return send(res, 503, {
        error: "Translation service is temporarily disabled.",
        code: "KILL_SWITCH",
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return send(res, 500, {
        error: "Server is missing OpenAI API key configuration.",
        code: "MISSING_API_KEY",
      });
    }

    // Parse and validate body
    let body: TranslateRequest;
    try {
      body = readJsonBody(req);
    } catch (e: any) {
      return send(res, 400, {
        error: "Invalid JSON body.",
        code: "VALIDATION_ERROR",
        details: e?.message ?? "Body parse failed",
      });
    }

    const text = body?.text ?? "";
    const mode: TranslateMode = body?.mode ?? "plain";
    const deviceId = body?.deviceId;

    const validationError = validateInput(text);
    if (validationError) {
      return send(res, 400, {
        error: validationError,
        code: "VALIDATION_ERROR",
      });
    }

    // Rate limit
    const clientKey = getClientKey(req, deviceId);
    const rl = checkRateLimit(clientKey);
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSeconds));
      return send(res, 429, {
        error: "Too many requests. Please try again later.",
        code: "RATE_LIMIT",
        retryAfterSeconds: rl.retryAfterSeconds,
      });
    }

    // Cache
    const cacheKey = `${mode}:${normalizeText(text)}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.createdMs < CACHE_TTL_MS) {
      return send(res, 200, { output: cached.output, cached: true });
    }

    // Build instruction (you asked to remove the earlier “You are Slangify…” prompt,
    // so this is a neutral, short instruction.)
    const systemByMode: Record<TranslateMode, string> = {
      plain: "Rewrite the text into clear, easy-to-understand English while preserving meaning and tone. Be concise.",
      professional: "Rewrite the text into clear, professional English while preserving meaning and tone. Be concise.",
      parent: "Rewrite the text into clear, family-friendly English while preserving meaning and tone. Be concise.",
    };

    // Call OpenAI (Chat Completions)
    const openaiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemByMode[mode] ?? systemByMode.plain },
          { role: "user", content: text },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text().catch(() => "");
      console.error("OpenAI error:", openaiResponse.status, errText);

      return send(res, 502, {
        error: "Translation failed. Please try again.",
        code: "UPSTREAM_ERROR",
        upstreamStatus: openaiResponse.status,
        details: errText?.slice(0, 400) || "No upstream details",
      });
    }

    const data = (await openaiResponse.json()) as any;
    const output: string | undefined = data?.choices?.[0]?.message?.content;

    if (!output || typeof output !== "string") {
      console.error("Unexpected OpenAI response shape:", JSON.stringify(data)?.slice(0, 800));
      return send(res, 500, {
        error: "Unexpected response from translation provider.",
        code: "INTERNAL_ERROR",
      });
    }

    const finalText = output.trim();

    cache.set(cacheKey, { output: finalText, createdMs: Date.now() });

    return send(res, 200, { output: finalText, cached: false });
  } catch (err: any) {
    console.error("Unhandled translate error:", err);
    return send(res, 500, {
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
      details: err?.message ?? "Unknown error",
    });
  }
}

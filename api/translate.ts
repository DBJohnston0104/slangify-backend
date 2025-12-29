import type { VercelRequest, VercelResponse } from "@vercel/node";

interface TranslationResult {
  detectedGeneration: string;
  originalText: string;
  translations: Array<{
    generation: string;
    text: string;
    slangWords: Array<{ word: string; definition: string }>;
  }>;
}

interface TranslateRequest {
  text: string;
  deviceId?: string;
}

const CONFIG = {
  KILL_SWITCH_ENABLED: false,
  MAX_CHARACTERS: 80,
  MAX_WORDS: 20,
  RATE_LIMIT_REQUESTS: 10,
  RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  // Keep this high enough for 6 generations + slangWords; 900–1200 is reasonable.
  MAX_OUTPUT_TOKENS: 1100,
};

const rateLimitStore: Map<string, { count: number; windowStart: number }> = new Map();
const cacheStore: Map<string, { result: TranslationResult; timestamp: number; normalizedText: string }> = new Map();

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function getCacheKey(text: string): string {
  const normalized = normalizeText(text);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `cache_${Math.abs(hash)}`;
}

function validateInput(text: string): { valid: boolean; error?: { error: string; code: string } } {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return { valid: false, error: { error: "Please enter some text to translate.", code: "INVALID_INPUT" } };
  }
  const trimmed = text.trim();
  if (trimmed.length > CONFIG.MAX_CHARACTERS) {
    return {
      valid: false,
      error: { error: `Text is too long. Please keep it under ${CONFIG.MAX_CHARACTERS} characters.`, code: "INPUT_TOO_LONG" },
    };
  }
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > CONFIG.MAX_WORDS) {
    return {
      valid: false,
      error: { error: `Too many words. Please keep it under ${CONFIG.MAX_WORDS} words.`, code: "TOO_MANY_WORDS" },
    };
  }
  return { valid: true };
}

function checkRateLimit(deviceId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = deviceId || "anonymous";
  const data = rateLimitStore.get(key);

  if (!data || now - data.windowStart > CONFIG.RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (data.count >= CONFIG.RATE_LIMIT_REQUESTS) {
    const timeUntilReset = Math.ceil((data.windowStart + CONFIG.RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(0, timeUntilReset) };
  }

  data.count++;
  rateLimitStore.set(key, data);
  return { allowed: true };
}

function getFromCache(text: string): TranslationResult | null {
  const cacheKey = getCacheKey(text);
  const entry = cacheStore.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CONFIG.CACHE_TTL_MS) {
    cacheStore.delete(cacheKey);
    return null;
  }
  if (entry.normalizedText !== normalizeText(text)) return null;
  return entry.result;
}

function saveToCache(text: string, result: TranslationResult): void {
  const cacheKey = getCacheKey(text);
  if (cacheStore.size > 100) {
    const entries = Array.from(cacheStore.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    entries.slice(0, 50).forEach(([key]) => cacheStore.delete(key));
  }
  cacheStore.set(cacheKey, { result, timestamp: Date.now(), normalizedText: normalizeText(text) });
}

function parseBody(req: VercelRequest): TranslateRequest {
  // Vercel sometimes provides body as a string
  if (typeof req.body === "string") return JSON.parse(req.body);
  return (req.body ?? {}) as TranslateRequest;
}

// NOTE: This prompt is intentionally strict and shorter to reduce truncation risk.
const SYSTEM_PROMPT = `Return ONLY valid JSON matching this schema exactly. No markdown. No extra text.

Schema:
{
  "detectedGeneration": "Classic" | "Baby Boomers" | "Gen X" | "Millennials" | "Gen Z" | "Gen Alpha" | "Standard English",
  "originalText": string,
  "translations": [
    {
      "generation": "Classic" | "Baby Boomers" | "Gen X" | "Millennials" | "Gen Z" | "Gen Alpha",
      "text": string,
      "slangWords": [{"word": string, "definition": string}]
    }
  ]
}

Rules:
- Include ALL 6 generations in translations (Classic, Baby Boomers, Gen X, Millennials, Gen Z, Gen Alpha).
- slangWords must include ONLY the slang terms you used in that translation; may be empty [].
- Keep translations accurate and natural; do not invent definitions that are obviously wrong.
- Ensure the JSON is complete and parseable.`;

// Simple structure validation so the app never receives “incomplete” output silently.
function isValidResult(x: any): x is TranslationResult {
  if (!x || typeof x !== "object") return false;
  if (typeof x.detectedGeneration !== "string") return false;
  if (typeof x.originalText !== "string") return false;
  if (!Array.isArray(x.translations) || x.translations.length !== 6) return false;

  for (const t of x.translations) {
    if (!t || typeof t !== "object") return false;
    if (typeof t.generation !== "string") return false;
    if (typeof t.text !== "string") return false;
    if (!Array.isArray(t.slangWords)) return false;
    for (const sw of t.slangWords) {
      if (!sw || typeof sw.word !== "string" || typeof sw.definition !== "string") return false;
    }
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });

  try {
    if (CONFIG.KILL_SWITCH_ENABLED) {
      return res.status(503).json({ error: "Translation service is temporarily unavailable.", code: "SERVICE_DISABLED" });
    }

    const body = parseBody(req);
    const { text, deviceId } = body;

    const validation = validateInput(text);
    if (!validation.valid) return res.status(400).json(validation.error);

    const cachedResult = getFromCache(text);
    if (cachedResult) return res.status(200).json({ output: cachedResult, cached: true });

    const rateLimitResult = checkRateLimit(deviceId || "anonymous");
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil((rateLimitResult.retryAfter || 0) / 60);
      return res.status(429).json({
        error: `Too many requests. Please wait ${minutes} minute${minutes !== 1 ? "s" : ""}.`,
        code: "RATE_LIMITED",
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY not configured");
      return res.status(500).json({ error: "Translation service is not configured.", code: "SERVER_ERROR" });
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: CONFIG.MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.trim() },
        ],
      }),
    });

    const rawText = await openaiResponse.text();

    if (!openaiResponse.ok) {
      console.error("OpenAI API Error:", openaiResponse.status, rawText);
      if (openaiResponse.status === 429) {
        return res.status(429).json({ error: "Service is busy. Please try again.", code: "RATE_LIMITED", retryAfter: 30 });
      }
      return res.status(500).json({ error: "Translation failed. Please try again.", code: "SERVER_ERROR" });
    }

    // Parse OpenAI JSON envelope first
    let envelope: any;
    try {
      envelope = JSON.parse(rawText);
    } catch {
      console.error("OpenAI returned non-JSON envelope:", rawText.slice(0, 500));
      return res.status(500).json({ error: "Could not parse translation.", code: "PARSE_ERROR" });
    }

    const resultText: string = envelope?.choices?.[0]?.message?.content?.trim?.() ?? "";
    if (!resultText) {
      console.error("Empty content from OpenAI:", JSON.stringify(envelope).slice(0, 800));
      return res.status(500).json({ error: "Translation response was incomplete.", code: "INCOMPLETE_RESPONSE" });
    }

    // Now parse the model-produced JSON
    let result: TranslationResult;
    try {
      result = JSON.parse(resultText);
    } catch {
      // Last-resort: try to extract the JSON object if model leaked text (rare with strict prompt)
      const jsonMatch = resultText.match(/\{[\s\S]*\}\s*$/);
      if (!jsonMatch) {
        console.error("Could not parse model JSON:", resultText.slice(0, 500));
        return res.status(500).json({ error: "Could not parse translation.", code: "PARSE_ERROR" });
      }
      try {
        result = JSON.parse(jsonMatch[0]);
      } catch {
        console.error("Model JSON parse error:", jsonMatch[0].slice(0, 500));
        return res.status(500).json({ error: "Could not parse translation.", code: "PARSE_ERROR" });
      }
    }

    if (!isValidResult(result)) {
      console.error("Result structure invalid/incomplete:", JSON.stringify(result).slice(0, 800));
      return res.status(500).json({ error: "Translation response was incomplete.", code: "INCOMPLETE_RESPONSE" });
    }

    saveToCache(text, result);
    return res.status(200).json({ output: result });
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "Something went wrong.", code: "SERVER_ERROR" });
  }
}

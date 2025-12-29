import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Serverless API Endpoint: POST /api/translate
 *
 * Deploy to Vercel with OPENAI_API_KEY environment variable.
 *
 * Request: POST with JSON body { "text": "string", "deviceId": "string" }
 * Response: { "output": TranslationResult } or { "error": "string", "code": "string" }
 */

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  KILL_SWITCH_ENABLED: false,
  MAX_CHARACTERS: 80,
  MAX_WORDS: 20,
  RATE_LIMIT_REQUESTS: 10,
  RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  MAX_OUTPUT_TOKENS: 800,
};

// ============================================================================
// IN-MEMORY STORES (Note: resets on cold start - use Redis in production)
// ============================================================================

const rateLimitStore: Map<string, { count: number; windowStart: number }> = new Map();
const cacheStore: Map<string, { result: TranslationResult; timestamp: number; normalizedText: string }> = new Map();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function getCacheKey(text: string): string {
  const normalized = normalizeText(text);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `cache_${Math.abs(hash)}`;
}

function validateInput(text: string): { valid: boolean; error?: { error: string; code: string } } {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return { valid: false, error: { error: "Please enter some text to translate.", code: "INVALID_INPUT" } };
  }
  const trimmed = text.trim();
  if (trimmed.length > CONFIG.MAX_CHARACTERS) {
    return { valid: false, error: { error: `Text is too long. Please keep it under ${CONFIG.MAX_CHARACTERS} characters.`, code: "INPUT_TOO_LONG" } };
  }
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount > CONFIG.MAX_WORDS) {
    return { valid: false, error: { error: `Too many words. Please keep it under ${CONFIG.MAX_WORDS} words.`, code: "TOO_MANY_WORDS" } };
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

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are a comprehensive slang translation expert. Analyze the input text and:
1. Detect which generation's slang it uses (Classic, Baby Boomers, Gen X, Millennials, Gen Z, Gen Alpha, or Standard English)
2. Translate it to ALL other generations' slang styles
3. For each translation, identify the slang words used and provide their definitions

Generation definitions:
- Classic: 1950s - 1970s era slang (groovy, hip, cool cat, daddy-o, far out)
- Baby Boomers: Born 1946 - 1964 (right on, bummer, boogie, peace out)
- Gen X: Born 1965 - 1980 (rad, gnarly, totally, psych, as if, whatever)
- Millennials: Born 1981 - 1996 (GOAT, slay, iconic, adulting, ghosting, basic)
- Gen Z: Born 1997 - 2009 (no cap, bussin, glazing, based, mid, ratio, delulu, aura)
- Gen Alpha: Born 2010 - Current (skibidi, gyatt, rizz, ohio, sigma, mewing, fanum tax)

Return ONLY a valid JSON object with this exact structure:
{
  "detectedGeneration": "Classic" | "Baby Boomers" | "Gen X" | "Millennials" | "Gen Z" | "Gen Alpha" | "Standard English",
  "originalText": "the input text",
  "translations": [
    {
      "generation": "Classic" | "Baby Boomers" | "Gen X" | "Millennials" | "Gen Z" | "Gen Alpha",
      "text": "translated text",
      "slangWords": [
        {"word": "slang word", "definition": "what it means"}
      ]
    }
  ]
}

Include translations for all 6 generations. Be creative with generation-specific slang but keep translations accurate and natural.`;

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  try {
    // 1. Check kill switch
    if (CONFIG.KILL_SWITCH_ENABLED) {
      return res.status(503).json({ error: "Translation service is temporarily unavailable.", code: "SERVICE_DISABLED" });
    }

    // 2. Parse request body
    const body: TranslateRequest = req.body;
    const { text, deviceId } = body;

    // 3. Validate input
    const validation = validateInput(text);
    if (!validation.valid) {
      return res.status(400).json(validation.error);
    }

    // 4. Check cache first
    const cachedResult = getFromCache(text);
    if (cachedResult) {
      return res.status(200).json({ output: cachedResult, cached: true });
    }

    // 5. Check rate limit
    const rateLimitResult = checkRateLimit(deviceId || "anonymous");
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil((rateLimitResult.retryAfter || 0) / 60);
      return res.status(429).json({
        error: `Too many requests. Please wait ${minutes} minute${minutes !== 1 ? "s" : ""}.`,
        code: "RATE_LIMITED",
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // 6. Get API key from environment
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY not configured");
      return res.status(500).json({ error: "Translation service is not configured.", code: "SERVER_ERROR" });
    }

    // 7. Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-2024-11-20",
        max_tokens: CONFIG.MAX_OUTPUT_TOKENS,
        temperature: 0.8,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.trim() },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error("OpenAI API Error:", openaiResponse.status, errorData);

      if (openaiResponse.status === 429) {
        return res.status(429).json({ error: "Service is busy. Please try again.", code: "RATE_LIMITED", retryAfter: 30 });
      }
      return res.status(500).json({ error: "Translation failed. Please try again.", code: "SERVER_ERROR" });
    }

    const data = await openaiResponse.json();
    const resultText = data.choices?.[0]?.message?.content?.trim() || "";

    // 8. Parse JSON response
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not parse OpenAI response:", resultText);
      return res.status(500).json({ error: "Could not parse translation.", code: "PARSE_ERROR" });
    }

    let result: TranslationResult;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("JSON parse error:", jsonMatch[0]);
      return res.status(500).json({ error: "Could not parse translation.", code: "PARSE_ERROR" });
    }

    // 9. Save to cache
    saveToCache(text, result);

    // 10. Return success
    return res.status(200).json({ output: result });

  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "Something went wrong.", code: "SERVER_ERROR" });
  }
}

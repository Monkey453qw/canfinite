/**
 * POST /api/math-solve
 *
 * Unified math solver — handles BOTH image (handwritten/OCR) and text (expression)
 * inputs. Uses z-ai-web-dev-sdk with:
 *   - Local math evaluator for simple arithmetic (instant, no API call)
 *   - Result cache (30 min TTL)
 *   - Retry logic with exponential backoff (1s, 3s, 6s)
 *   - Rate limiter (20 req/min)
 *
 * Request body:
 *   { image?: string (base64 data URL), expression?: string, context?: string }
 *
 * Response:
 *   { recognized: string, result: string, steps: string[] }
 */

import ZAI from "z-ai-web-dev-sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============ Cached ZAI SDK Instance ============
// The z-ai-web-dev-sdk's ZAI.create() looks for a .z-ai-config file in
// process.cwd(), os.homedir(), or /etc/ — none of which are writable or
// pre-populated on serverless platforms like Vercel. We bypass create()
// and construct the ZAI client directly from environment variables, which
// works on Vercel, Netlify, Cloudflare, and any other serverless host.
//
// Required env vars (set them in your Vercel project settings):
//   ZAI_BASE_URL  — e.g. https://internal-api.z.ai/v1
//   ZAI_API_KEY   — e.g. Z.ai
//   ZAI_TOKEN     — JWT issued for your account
//   ZAI_USER_ID   — UUID of your user
//   ZAI_CHAT_ID   — chat session UUID (optional; SDK will work without it)
let zaiInstance: any = null;
let zaiInstancePromise: Promise<any> | null = null;

async function getZAI(): Promise<any> {
  if (zaiInstance) return zaiInstance;
  if (zaiInstancePromise) return zaiInstancePromise;

  zaiInstancePromise = Promise.resolve().then(() => {
    const config: Record<string, string> = {
      baseUrl: process.env.ZAI_BASE_URL || "https://internal-api.z.ai/v1",
      apiKey: process.env.ZAI_API_KEY || "Z.ai",
      token: process.env.ZAI_TOKEN!,
      userId: process.env.ZAI_USER_ID!,
    };
    const chatId = process.env.ZAI_CHAT_ID;
    if (chatId) config.chatId = chatId;

    if (!config.token || !config.userId) {
      throw new Error(
        "Missing ZAI_TOKEN or ZAI_USER_ID environment variables. " +
          "Set them in your Vercel project settings (Settings → Environment Variables)."
      );
    }

    // Construct directly — bypasses the file-based config loader in ZAI.create()
    zaiInstance = new (ZAI as any)(config);
    zaiInstancePromise = null;
    return zaiInstance;
  });

  return zaiInstancePromise;
}

// ============ Local Math Evaluator ============
// Solves simple expressions instantly without calling the AI API.
interface LocalResult {
  recognized: string;
  result: string;
  steps: string[];
  wasLocal?: boolean;
}

function tryLocalMath(expression: string): LocalResult | null {
  const expr = expression.trim();
  let normalized = expr
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/\^/g, "**")
    .replace(/π/g, `(${Math.PI})`)
    .replace(/e(?![a-zA-Z])/g, `(${Math.E})`);

  const mathFunctions = [
    "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "sqrt", "cbrt", "abs", "log", "ln", "log2", "log10", "exp", "ceil", "floor", "round", "sign",
  ];
  let checkStr = normalized;
  for (const fn of mathFunctions) {
    checkStr = checkStr.replace(new RegExp(fn, "gi"), "");
  }
  checkStr = checkStr.replace(/Math\./g, "");
  if (/[a-zA-Z]/.test(checkStr)) return null; // Has variables — needs AI

  let hasDegrees = false;
  normalized = normalized.replace(/(\d+(?:\.\d+)?)°/g, (_match, num: string) => {
    hasDegrees = true;
    return `(${parseFloat(num) * Math.PI / 180})`;
  });

  const fnMap: Record<string, string> = {
    sin: "Math.sin", cos: "Math.cos", tan: "Math.tan",
    asin: "Math.asin", acos: "Math.acos", atan: "Math.atan",
    sinh: "Math.sinh", cosh: "Math.cosh", tanh: "Math.tanh",
    sqrt: "Math.sqrt", cbrt: "Math.cbrt", abs: "Math.abs",
    ln: "Math.log", log: "Math.log10", log2: "Math.log2",
    log10: "Math.log10", exp: "Math.exp",
    ceil: "Math.ceil", floor: "Math.floor", round: "Math.round", sign: "Math.sign",
  };
  const sortedFns = Object.keys(fnMap).sort((a, b) => b.length - a.length);
  for (const fn of sortedFns) {
    normalized = normalized.replace(new RegExp(`\\b${fn}\\b`, "gi"), fnMap[fn]);
  }
  normalized = normalized.replace(/√(\d+(?:\.\d+)?)/g, "Math.sqrt($1)");

  const safePattern = /^[0-9+\-*/().%,\sMath sincotagqrtbelfxp2]+$/;
  if (!safePattern.test(normalized)) return null;

  try {
    const evalResult = new Function(`"use strict"; return (${normalized})`)();
    if (typeof evalResult !== "number" || !isFinite(evalResult)) return null;
    let formatted: string;
    if (Number.isInteger(evalResult)) formatted = evalResult.toString();
    else formatted = parseFloat(evalResult.toPrecision(12)).toString();
    const displayExpr = expr.replace(/\*/g, "×").replace(/\//g, "÷").replace(/\*\*/g, "^");
    return {
      recognized: displayExpr,
      result: formatted,
      steps: [hasDegrees ? `Convert degrees to radians and evaluate: ${displayExpr}` : `Compute: ${displayExpr}`],
      wasLocal: true,
    };
  } catch {
    return null;
  }
}

// ============ Rate Limiter ============
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(): boolean {
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE;
}

function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

// ============ Result Cache ============
interface CacheEntry {
  result: any;
  timestamp: number;
}
const resultCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60_000;

function getCacheKey(image?: string, expression?: string): string {
  if (expression) return `expr:${expression.trim().toLowerCase()}`;
  if (image) return `img:${image.substring(0, 200)}:${image.length}`;
  return "";
}

function getCachedResult(key: string): any | null {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedResult(key: string, result: any): void {
  if (resultCache.size > 200) {
    const oldestKey = resultCache.keys().next().value;
    if (oldestKey) resultCache.delete(oldestKey);
  }
  resultCache.set(key, { result, timestamp: Date.now() });
}

// ============ Retry Logic ============
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 6000];

function isRetryableError(error: any): boolean {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status || error?.statusCode || 0;
  return (
    status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
    msg.includes("rate limit") || msg.includes("too many") || msg.includes("overloaded") ||
    msg.includes("timeout") || msg.includes("network") || msg.includes("econnreset") ||
    msg.includes("econnrefused") || msg.includes("fetch failed") ||
    msg.includes("service unavailable") || msg.includes("internal server error")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ Vision API Call with Retry ============
async function callVisionAPI(zai: any, image: string): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Vision API retry ${attempt}/${MAX_RETRIES}, waiting ${RETRY_DELAYS[attempt - 1]}ms...`);
        await sleep(RETRY_DELAYS[attempt - 1]);
      }
      const completion = await zai.chat.completions.createVision({
        model: "glm-4.6v",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert math solver. This image contains a handwritten or typed math expression or equation. Recognize it accurately and solve it step by step. Return ONLY a valid JSON object with this exact format (no markdown, no code blocks, no extra text):
{"recognized": "the recognized expression as formatted math text", "result": "the final simplified answer", "steps": ["step 1", "step 2", ...]}

Rules:
- If it's an equation, solve for the variable
- If it's an arithmetic expression, compute the result
- If it's a derivative/integral, compute it
- Support: arithmetic, algebra, trigonometry, calculus, logarithms, matrices, physics, chemistry
- If the image contains no recognizable math, return {"recognized": "", "result": "No math expression found", "steps": []}
- Keep the result concise (just the answer, no explanation in the result field)
- Steps should be clear and educational
- IMPORTANT: Use simple Unicode symbols, NOT LaTeX. Examples:
  - Use ± (not \\pm), √ (not \\sqrt{}), × (not \\times), ÷ (not \\div)
  - Use ≤ ≥ ≠ ≈ (not \\leq \\geq \\neq \\approx)
  - Write fractions as a/b (not \\frac{a}{b})
  - Use π θ α β etc. directly (not \\pi \\theta \\alpha)
  - Use superscripts ² ³ (not ^2 ^3)
- Return ONLY the JSON object, no other text`,
              },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      });
      const content = completion.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return {
        recognized: "Handwritten expression",
        result: content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(),
        steps: [],
      };
    } catch (error: any) {
      lastError = error;
      console.error(`Vision API attempt ${attempt + 1} failed:`, error.message);
      if (!isRetryableError(error)) break;
    }
  }
  // All retries exhausted
  const errorMsg = lastError?.message?.toLowerCase() || "";
  if (errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
    return { recognized: "", result: "Rate limit reached. Please wait a moment and try again.", steps: [] };
  }
  return {
    recognized: "",
    result: "Could not read the problem. Please try again or type the equation.",
    steps: [],
  };
}

// ============ Text API Call with Retry ============
async function callTextAPI(zai: any, expression: string): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Text API retry ${attempt}/${MAX_RETRIES}, waiting ${RETRY_DELAYS[attempt - 1]}ms...`);
        await sleep(RETRY_DELAYS[attempt - 1]);
      }
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert math solver. Solve the given math expression or equation step by step. Return ONLY a valid JSON object with this exact format (no markdown, no code blocks, no extra text):
{"recognized": "the expression", "result": "the final simplified answer", "steps": ["step 1", "step 2", ...]}

Rules:
- If it's an equation, solve for the variable
- If it's an arithmetic expression, compute the result
- Support: arithmetic, algebra, trigonometry, calculus, logarithms, matrices, physics, chemistry
- Keep the result concise (just the answer)
- Steps should be clear and educational
- IMPORTANT: Use simple Unicode symbols, NOT LaTeX. Examples:
  - Use ± (not \\pm), √ (not \\sqrt{}), × (not \\times), ÷ (not \\div)
  - Use ≤ ≥ ≠ ≈ (not \\leq \\geq \\neq \\approx)
  - Write fractions as a/b (not \\frac{a}{b})
  - Use π θ α β etc. directly (not \\pi \\theta \\alpha)
  - Use superscripts ² ³ (not ^2 ^3)`,
          },
          { role: "user", content: `Solve this: ${expression}` },
        ],
      });
      const content = completion.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return {
        recognized: expression,
        result: content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(),
        steps: [],
      };
    } catch (error: any) {
      lastError = error;
      console.error(`Text API attempt ${attempt + 1} failed:`, error.message);
      if (!isRetryableError(error)) break;
    }
  }
  const errorMsg = lastError?.message?.toLowerCase() || "";
  if (errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
    return { recognized: expression, result: "Rate limit reached. Please wait a moment and try again.", steps: [] };
  }
  return { recognized: expression, result: "Math solver temporarily unavailable. Please try again.", steps: [] };
}

// ============ Main Handler ============
export async function POST(req: Request) {
  try {
    const { image, expression, context } = await req.json();

    if (!image && !expression) {
      return NextResponse.json({ recognized: "", result: "No input provided", steps: [] });
    }

    // Rate limit check
    if (isRateLimited()) {
      return NextResponse.json(
        { recognized: expression || "", result: "Too many requests. Please wait a moment.", steps: [] },
        { status: 429 },
      );
    }

    // Check cache
    const cacheKey = getCacheKey(image, expression);
    if (cacheKey) {
      const cached = getCachedResult(cacheKey);
      if (cached) {
        console.log("Returning cached result");
        return NextResponse.json(cached);
      }
    }

    // Try local math evaluator first (instant, no API call) for text expressions
    if (expression && !image) {
      const localResult = tryLocalMath(expression);
      if (localResult) {
        console.log(`Local math eval: "${expression}" → ${localResult.result}`);
        if (cacheKey) setCachedResult(cacheKey, localResult);
        return NextResponse.json(localResult);
      }
    }

    recordRequest();
    const zai = await getZAI();

    let result: any;
    if (image) {
      result = await callVisionAPI(zai, image);
    } else if (expression) {
      result = await callTextAPI(zai, expression);
    }

    // Add context to recognized if provided
    if (context && result) {
      result.recognized = result.recognized || expression || "";
    }

    // Cache successful results
    if (cacheKey && result?.result && result.result !== "No math expression found") {
      setCachedResult(cacheKey, result);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Math solver error:", error);
    const errorMsg = (error?.message || "").toLowerCase();
    if (errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
      return NextResponse.json(
        { recognized: "", result: "Rate limit reached. Please wait a moment.", steps: [] },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { recognized: "", result: "Error: " + (error.message || "Unknown error"), steps: [] },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/math-solve",
    body: "{ image?: string (base64), expression?: string, context?: string }",
    response: "{ recognized: string, result: string, steps: string[] }",
  });
}

/**
 * llm.ts
 *
 * Centralized Multi-Provider LLM abstraction for ComplyGuard.
 * Provides a resilient multi-tier fallback architecture:
 *   Tier 1: OpenRouter (Primary & Free fallbacks)
 *   Tier 2: Groq (openai/gpt-oss-120B & fast open-weights)
 *   Tier 3: NVIDIA NIM (ChatNVIDIA: Llama-3.3, Nemotron)
 *   Tier 4: Google Gemini (ChatGoogleGenerativeAI: gemini-2.0-flash)
 *   Tier 5: Deterministic rule-based fallback
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// ChatNVIDIA implementation (OpenAI-compatible NVIDIA NIM Catalog)
// ─────────────────────────────────────────────────────────────────

export type ChatNVIDIAInput = {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  configuration?: Record<string, any>;
  [key: string]: any;
};

/**
 * ChatNVIDIA
 * Connects to NVIDIA NIM / API Catalog microservices via OpenAI-compatible API.
 */
export class ChatNVIDIA extends ChatOpenAI {
  constructor(fields?: ChatNVIDIAInput) {
    const apiKey =
      fields?.apiKey ||
      process.env.NVIDIA_API_KEY?.trim() ||
      process.env.NVIDIA_NIM_API_KEY?.trim() ||
      "";

    const { apiKey: _key, configuration, ...rest } = fields || {};

    super({
      model: fields?.model || "meta/llama-3.3-70b-instruct",
      temperature: fields?.temperature ?? 0.2,
      apiKey: apiKey,
      configuration: {
        baseURL: "https://integrate.api.nvidia.com/v1",
        ...(configuration || {}),
      },
      ...rest,
    } as any);
  }
}

// Re-export providers for direct access across the application
export { ChatOpenAI, ChatGroq, ChatGoogleGenerativeAI };

// ─────────────────────────────────────────────────────────────────
// Model Configurations & Fallback Tiers
// ─────────────────────────────────────────────────────────────────

export const LLM_CONFIG = {
  TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS || "8000", 10),
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.2,

  OPENROUTER: {
    PRIMARY:
      process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3.5-lightning:free",
    FALLBACKS: [
      "openrouter/free",
      "nvidia/nemotron-3.5-super-vl:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
  },

  GROQ: {
    PRIMARY: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
    FALLBACKS: [
      "openai/gpt-oss-20b",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
    ],
  },

  NVIDIA: {
    PRIMARY: process.env.NVIDIA_MODEL?.trim() || "nvidia/nemotron-3.5-lightning-30b-a3b",
    FALLBACKS: [
        "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-4-340b-instruct",
      "nvidia/nemotron-3.5-super-vl-120b-a12b",
      "meta/llama-3.1-70b-instruct",
      "meta/llama-3.1-8b-instruct",
    ],
  },

  GEMINI: {
    PRIMARY: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    FALLBACKS: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  },
};

// ─────────────────────────────────────────────────────────────────
// Factory Helpers
// ─────────────────────────────────────────────────────────────────

export function createOpenRouterModel(modelName: string): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  return new ChatOpenAI({
    model: modelName,
    temperature: LLM_CONFIG.TEMPERATURE,
    apiKey,
    maxTokens: LLM_CONFIG.MAX_TOKENS,
    timeout: LLM_CONFIG.TIMEOUT_MS,
    maxRetries: 0,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://complyguard.app",
        "X-Title": "ComplyGuard",
      },
    },
  });
}

export function createGroqModel(modelName: string): ChatGroq {
  const apiKey = process.env.GROQ_API_KEY?.trim() || "";
  return new ChatGroq({
    apiKey,
    model: modelName,
    temperature: LLM_CONFIG.TEMPERATURE,
    maxTokens: LLM_CONFIG.MAX_TOKENS,
    timeout: LLM_CONFIG.TIMEOUT_MS,
    maxRetries: 0,
  });
}

export function createNvidiaModel(modelName: string): ChatNVIDIA {
  const apiKey =
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.NVIDIA_NIM_API_KEY?.trim() ||
    "";
  return new ChatNVIDIA({
    apiKey,
    model: modelName,
    temperature: LLM_CONFIG.TEMPERATURE,
    maxTokens: LLM_CONFIG.MAX_TOKENS,
    timeout: LLM_CONFIG.TIMEOUT_MS,
    maxRetries: 0,
  });
}

export function createGeminiModel(modelName: string): ChatGoogleGenerativeAI {
  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    "";
  return new ChatGoogleGenerativeAI({
    apiKey,
    model: modelName,
    temperature: LLM_CONFIG.TEMPERATURE,
    maxOutputTokens: LLM_CONFIG.MAX_TOKENS,
    maxRetries: 0,
  });
}

// ─────────────────────────────────────────────────────────────────
// Output Normalizer & Parser
// ─────────────────────────────────────────────────────────────────

/**
 * Normalizes loose or alternate JSON keys returned by various LLM providers
 * into standard expected schema properties.
 */
function normalizeOutputData(parsed: Record<string, any>): Record<string, any> {
  let data = { ...parsed };

  // Unpack nested results if wrapped in "result" or "data"
  if (data.result && typeof data.result === "object" && !Array.isArray(data.result)) {
    data = data.result;
  } else if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    data = data.data;
  }

  // 1. Normalize 'pass' boolean
  if (data.pass === undefined) {
    if (typeof data.compliant === "boolean") data.pass = data.compliant;
    else if (typeof data.passed === "boolean") data.pass = data.passed;
    else if (typeof data.isCompliant === "boolean") data.pass = data.isCompliant;
    else if (typeof data.valid === "boolean") data.pass = data.valid;
    else if (Array.isArray(data.flagged)) data.pass = data.flagged.length === 0;
    else if (Array.isArray(data.violations)) data.pass = data.violations.length === 0;
    else data.pass = true;
  }

  // 2. Normalize 'flagged' array for Check 15
  if (data.flagged === undefined) {
    if (Array.isArray(data.violations)) data.flagged = data.violations;
    else if (Array.isArray(data.issues)) data.flagged = data.issues;
    else if (Array.isArray(data.problematicProducts)) data.flagged = data.problematicProducts;
    else data.flagged = [];
  }

  if (Array.isArray(data.flagged)) {
    data.flagged = data.flagged.map((item: any) => {
      if (typeof item === "string") {
        return {
          product: "Product",
          claim: item,
          violationType: "unverifiable_guarantee",
        };
      }
      if (typeof item === "object" && item !== null) {
        return {
          product: item.product || item.title || item.name || "Product",
          claim: item.claim || item.violation || item.issue || item.reason || item.phrase || "",
          violationType:
            item.violationType || item.type || item.category || "unverifiable_guarantee",
        };
      }
      return {
        product: "Product",
        claim: String(item),
        violationType: "unverifiable_guarantee",
      };
    });
  }

  // 3. Normalize 'reason' string
  if (data.reason === undefined) {
    data.reason =
      data.summary ||
      data.explanation ||
      data.message ||
      data.details ||
      (data.pass ? "Check passed" : "Compliance issues detected");
  }

  // 4. Normalize 'detectedAddress' string for Check 9
  if (data.detectedAddress === undefined) {
    if (typeof data.address === "string") data.detectedAddress = data.address;
    else if (typeof data.detected_address === "string") data.detectedAddress = data.detected_address;
    else data.detectedAddress = "";
  }

  // 5. Normalize 'missingElements' array for Check 2
  if (data.missingElements === undefined) {
    if (Array.isArray(data.missing)) data.missingElements = data.missing;
    else if (Array.isArray(data.missing_elements)) data.missingElements = data.missing_elements;
    else data.missingElements = [];
  }

  return data;
}

/**
 * Invokes an arbitrary LLM instance with structured output support,
 * falling back to raw JSON prompt parsing if tool-calling is unsupported.
 */
export async function invokeModelWithSchema<T>(
  model: any,
  schema: z.ZodSchema<T>,
  messages: Array<{ role: "system" | "user"; content: string }>
): Promise<T> {
  // Strategy A: Native Structured Output
  try {
    if (typeof model.withStructuredOutput === "function") {
      const structuredModel = model.withStructuredOutput(schema);
      const res = await structuredModel.invoke(messages);
      if (res) return res as T;
    }
  } catch (structuredErr) {
    // Proceed to raw JSON prompt fallback
  }

  // Strategy B: Raw JSON prompt with regex extraction & key normalization
  const jsonPrompt = [
    ...messages,
    {
      role: "user" as const,
      content:
        "IMPORTANT: Respond ONLY with a valid JSON object matching the requested schema. Do NOT include markdown formatting or backticks, just the raw JSON object.",
    },
  ];

  const rawRes = await model.invoke(jsonPrompt);
  const textContent =
    typeof rawRes?.content === "string"
      ? rawRes.content
      : Array.isArray(rawRes?.content)
      ? rawRes.content
          .map((c: any) => (typeof c === "string" ? c : c?.text || JSON.stringify(c)))
          .join(" ")
      : JSON.stringify(rawRes?.content || "");

  const jsonMatch = textContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON object found in response: ${textContent.slice(0, 150)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const normalized = normalizeOutputData(parsed);
  return schema.parse(normalized);
}

// ─────────────────────────────────────────────────────────────────
// Multi-Tier AI Invocation Orchestrator
// ─────────────────────────────────────────────────────────────────

/**
 * invokeMultiProviderAi
 *
 * Sequentially executes:
 *   1. Tier 1: OpenRouter (Primary & free fallbacks)
 *   2. Tier 2: Groq (openai/gpt-oss-120B & fallbacks)
 *   3. Tier 3: NVIDIA NIM (ChatNVIDIA)
 *   4. Tier 4: Google Gemini (ChatGoogleGenerativeAI)
 *   5. Tier 5: Deterministic rule fallback (never breaks scanner)
 */
export async function invokeMultiProviderAi<T>(
  schema: z.ZodSchema<T>,
  messages: Array<{ role: "system" | "user"; content: string }>,
  checkLabel: string,
  fallbackValue: T
): Promise<T> {
  // ─── TIER 1: OpenRouter ───
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const primary = LLM_CONFIG.OPENROUTER.PRIMARY;
    const candidates = [
      primary,
      ...LLM_CONFIG.OPENROUTER.FALLBACKS.filter((m) => m !== primary),
    ];

    for (const modelName of candidates) {
      try {
        console.log(`[${checkLabel}] [Tier 1: OpenRouter] Querying model: ${modelName}`);
        const model = createOpenRouterModel(modelName);
        const result = await invokeModelWithSchema(model, schema, messages);
        console.log(`[${checkLabel}] [Tier 1: OpenRouter] Succeeded with model: ${modelName}`);
        return result;
      } catch (err) {
        console.warn(
          `[${checkLabel}] [Tier 1: OpenRouter] Model ${modelName} failed (${(err as Error)?.message || err}). Trying next...`
        );
      }
    }
    console.warn(`[${checkLabel}] Tier 1 (OpenRouter) exhausted. Escalating to Tier 2 (Groq)...`);
  } else {
    console.log(`[${checkLabel}] No OPENROUTER_API_KEY found. Checking Tier 2 (Groq)...`);
  }

  // ─── TIER 2: Groq ───
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    const primary = LLM_CONFIG.GROQ.PRIMARY;
    const candidates = [
      primary,
      ...LLM_CONFIG.GROQ.FALLBACKS.filter((m) => m !== primary),
    ];

    for (const modelName of candidates) {
      try {
        console.log(`[${checkLabel}] [Tier 2: Groq] Querying model: ${modelName}`);
        const model = createGroqModel(modelName);
        const result = await invokeModelWithSchema(model, schema, messages);
        console.log(`[${checkLabel}] [Tier 2: Groq] Succeeded with model: ${modelName}`);
        return result;
      } catch (err) {
        console.warn(
          `[${checkLabel}] [Tier 2: Groq] Model ${modelName} failed (${(err as Error)?.message || err}). Trying next...`
        );
      }
    }
    console.warn(`[${checkLabel}] Tier 2 (Groq) exhausted. Escalating to Tier 3 (NVIDIA)...`);
  } else {
    console.log(`[${checkLabel}] No GROQ_API_KEY found. Checking Tier 3 (NVIDIA)...`);
  }

  // ─── TIER 3: NVIDIA (ChatNVIDIA) ───
  const nvidiaKey =
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.NVIDIA_NIM_API_KEY?.trim();
  if (nvidiaKey) {
    const primary = LLM_CONFIG.NVIDIA.PRIMARY;
    const candidates = [
      primary,
      ...LLM_CONFIG.NVIDIA.FALLBACKS.filter((m) => m !== primary),
    ];

    for (const modelName of candidates) {
      try {
        console.log(`[${checkLabel}] [Tier 3: NVIDIA] Querying model: ${modelName}`);
        const model = createNvidiaModel(modelName);
        const result = await invokeModelWithSchema(model, schema, messages);
        console.log(`[${checkLabel}] [Tier 3: NVIDIA] Succeeded with model: ${modelName}`);
        return result;
      } catch (err) {
        console.warn(
          `[${checkLabel}] [Tier 3: NVIDIA] Model ${modelName} failed (${(err as Error)?.message || err}). Trying next...`
        );
      }
    }
    console.warn(`[${checkLabel}] Tier 3 (NVIDIA) exhausted. Escalating to Tier 4 (Gemini)...`);
  } else {
    console.log(`[${checkLabel}] No NVIDIA_API_KEY found. Checking Tier 4 (Gemini)...`);
  }

  // ─── TIER 4: Gemini (ChatGoogleGenerativeAI) ───
  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim();
  if (geminiKey) {
    const primary = LLM_CONFIG.GEMINI.PRIMARY;
    const candidates = [
      primary,
      ...LLM_CONFIG.GEMINI.FALLBACKS.filter((m) => m !== primary),
    ];

    for (const modelName of candidates) {
      try {
        console.log(`[${checkLabel}] [Tier 4: Gemini] Querying model: ${modelName}`);
        const model = createGeminiModel(modelName);
        const result = await invokeModelWithSchema(model, schema, messages);
        console.log(`[${checkLabel}] [Tier 4: Gemini] Succeeded with model: ${modelName}`);
        return result;
      } catch (err) {
        console.warn(
          `[${checkLabel}] [Tier 4: Gemini] Model ${modelName} failed (${(err as Error)?.message || err}). Trying next...`
        );
      }
    }
    console.warn(`[${checkLabel}] Tier 4 (Gemini) exhausted.`);
  } else {
    console.log(`[${checkLabel}] No GEMINI_API_KEY / GOOGLE_API_KEY found.`);
  }

  // ─── TIER 5: Deterministic Rule Fallback ───
  console.warn(
    `[${checkLabel}] All AI tiers exhausted or failed. Using deterministic rule fallback.`
  );
  return fallbackValue;
}

// Backwards-compatible alias for existing callers
export const invokeAiWithFallback = invokeMultiProviderAi;

// Utility timeout wrapper
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[AI-Timeout] Operation timed out after ${ms / 1000}s, using rule fallback.`
      );
      resolve(fallback);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

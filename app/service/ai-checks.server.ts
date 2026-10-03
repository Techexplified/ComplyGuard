/**
 * ai-checks.server.ts
 *
 * LangChain + OpenRouter (GPT-4o-mini) AI-powered compliance checks.
 * Augments 3 weak checks in the deterministic scanner:
 *   - Check 2:  Refund policy quality (is it real or a blank template?)
 *   - Check 9:  Physical address detection (NLP-based entity detection)
 *   - Check 15: Risky / deceptive promotional claims in product listings
 *
 * Graceful fallback: if OPENROUTER_API_KEY is missing or the AI call fails,
 * all functions return a fallback result using simple keyword logic so the
 * scanner never breaks.
 */

import { ChatOpenAI } from "@langchain/openai";
// import path from "node:path";
// import os from "node:os";
import { z } from "zod";
import fs from "node:fs/promises";
// ─────────────────────────────────────────────────────────────────
// Shared LangChain model factory
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || "35000", 10);

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[AI-Check] Operation timed out after ${ms / 1000}s, falling back to rule check.`);
      resolve(fallback);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// cleanPageText
// ---------------------------------------------------------------------------
// Turns messy scraper output (visible text + leftover <script>/JSON-LD/JS
// snippets + stripped punctuation) into clean, human-readable text.
// ---------------------------------------------------------------------------
export function cleanPageText(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // --- 0. Normalise line endings -------------------------------------------
  text = text.replace(/\r\n?/g, "\n");

  // --- 1. Remove JSON-LD / inline JSON schema blocks -----------------------
  text = text.replace(/\{\s*"@context"[\s\S]*?\}\s*/g, " ");

  // --- 2. Remove <script> and <style> blocks (in case HTML is still present)
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<[^>]+>/g, " ");

  // --- 3. Remove JS block comments ----------------------------------------
  text = text.replace(/\/\*[\s\S]*?\*\//g, " ");

  // --- 4. Remove JS line comments (// ...) --------------------------------
  //     Keep the newline so we don't merge unrelated lines.
  text = text.replace(/(^|\s)\/\/[^\n]*/g, "$1 ");

  // --- 5. Remove `window.__X__ = ...` config blobs ------------------------
  //     Loose: stops at the next capitalised key or end-of-line.
  text = text.replace(
    /window\.__[A-Z0-9_]+__[\s\S]*?(?=\n|(?:\b[A-Z][a-zA-Z]+\s*:)|$)/g,
    " "
  );

  // --- 6. Remove `await import(...)` and static `import ... from "..."` ---
  text = text.replace(/await\s+import\s*\([^)]*\)\s*;?/g, " ");
  text = text.replace(
    /import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    " "
  );
  text = text.replace(
    /import\s+[^;]+?\s+from\s+['"][^'"]+['"]\s*;?/g,
    " "
  );

  // --- 7. Remove IIFEs: (function(){...})() ------------------------------
  text = text.replace(
    /\(function\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\)\s*\([^)]*\)\s*;?/g,
    " "
  );

  // --- 8. Remove common JS statement shapes -------------------------------
  //     These run AFTER punctuation may have been stripped by earlier
  //     cleaners, so we make them tolerant of missing {} () ; " '.
  text = text.replace(
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*[^\n.;]*[.;]?/g,
    " "
  );
  text = text.replace(
    /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{?/g,
    " "
  );
  text = text.replace(/\bfor\s*\([^)]*\)\s*\{?/g, " ");
  text = text.replace(/\bif\s*\([^)]*\)\s*\{?/g, " ");
  text = text.replace(/\belse\s*\{?/g, " ");
  text = text.replace(/\bnew\s+URL\s*\([^)]*\)\s*;?/g, " ");
  text = text.replace(/\bnew\s+[A-Z]\w*\s*\([^)]*\)\s*;?/g, " ");
  text = text.replace(/\bhydrate\s*\([^)]*\)\s*;?/g, " ");
  text = text.replace(/\bdocument\.[^\n.;]*[.;]?/g, " ");
  text = text.replace(/\bwindow\.[^\n.;]*[.;]?/g, " ");

  // --- 9. Remove URLs ------------------------------------------------------
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/\/\/[a-z0-9.-]+\.[a-z]{2,}\S*/gi, " ");

  // --- 10. Remove stray code punctuation runs -----------------------------
  //     Careful: we keep , . : - ( ) since addresses use them.
  text = text.replace(/[{};]+/g, " ");
  text = text.replace(/[<>`~^|\\]+/g, " ");
  text = text.replace(/[\[\]]+/g, " ");
  text = text.replace(/\s*=\s*/g, " ");

  // --- 11. Drop code-identifier fragments ---------------------------------
  //     Removes sentences made mostly of camelCase / snake_case / keywords.
  const CODE_WORD =
    /^(?:const|let|var|function|return|if|else|for|while|new|class|true|false|null|undefined)$/;
  text = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((frag) => {
      const t = frag.trim();
      if (t.length < 2) return false;
      const words = t.split(/\s+/);
      if (words.length === 0) return false;
      let codeish = 0;
      for (const w of words) {
        if (
          /^[a-z][a-z0-9]*[A-Z]/.test(w) || // camelCase
          /_/.test(w) ||                     // snake_case
          CODE_WORD.test(w)                  // keyword
        ) {
          codeish++;
        }
      }
      return codeish / words.length < 0.34; // keep human-looking fragments
    })
    .join(" ");

  // --- 12. Collapse whitespace --------------------------------------------
  text = text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

  return text;
}

// ---------------------------------------------------------------------------
// dedupeSentences
// ---------------------------------------------------------------------------
// Shopify renders header/footer twice. Collapse identical sentences/fragments.
// ---------------------------------------------------------------------------
export function dedupeSentences(text: string): string {
  const seen = new Set<string>();
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// extractAddressCandidates
// ---------------------------------------------------------------------------
// Finds address-like spans in raw text. Works even on messy input.
// ---------------------------------------------------------------------------
export function extractAddressCandidates(raw: string): string[] {
  if (!raw) return [];
  const results = new Set<string>();

  // Pattern A: number + street name + street type [+ optional rest]
  const PATTERN_A =
    /\b\d{1,6}\s+[A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9.'\-]+){0,4}?\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter|highway|hwy|parkway|pkwy|circle|cir|square|sq)\.?\b[\s\S]{0,140}?(?:\b\d{5}(?:-\d{4})?\b|\b[A-Z]{2}\b|\b[A-Z][a-z]+,\s*[A-Z]{2}\b|$)/gi;

  // Pattern B: PO Box
  const PATTERN_B = /\bp\.?\s*o\.?\s*box\s+\d+[\w\s,.-]{0,80}/gi;

  // Pattern C: Suite / Floor / Building + number (must be near a number)
  const PATTERN_C =
    /\b(?:suite|ste|floor|fl|building|bldg|unit|apt|apartment)\s*#?\s*\d+[A-Za-z]?\b[\s\S]{0,80}/gi;

  for (const re of [PATTERN_A, PATTERN_B, PATTERN_C]) {
    for (const m of raw.matchAll(re)) {
      const val = m[0].replace(/\s+/g, " ").trim();
      if (val.length >= 10) results.add(val);
    }
  }

  // Merge overlapping/near-duplicate spans by simple containment check
  const arr = [...results].sort((a, b) => b.length - a.length);
  const merged: string[] = [];
  for (const cand of arr) {
    if (!merged.some((m) => m.includes(cand) || cand.includes(m))) {
      merged.push(cand);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// preparePageText
// ---------------------------------------------------------------------------
// Full pipeline: clean → dedupe → (optionally) keep address candidates.
// ---------------------------------------------------------------------------
export function preparePageText(raw: string): string {
  const cleaned = cleanPageText(raw);
  const deduped = dedupeSentences(cleaned);

  // Optionally append a focused address section so the AI always sees it,
  // even if it sits past the 4000-char window.
  const candidates = extractAddressCandidates(raw);
  const addressBlock =
    candidates.length > 0
      ? `\n\n[address candidates]\n${candidates.join("\n")}`
      : "";

  return (deduped + addressBlock).trim();
}

function getModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  const modelName = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";

  return new ChatOpenAI({
    model: modelName,
    temperature: 0,
    apiKey: apiKey,
    maxTokens: 800,
    timeout: AI_TIMEOUT_MS,
    maxRetries: 1,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://complyguard.app",
        "X-Title": "ComplyGuard",
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// CHECK 2 — Refund Policy Quality
// ─────────────────────────────────────────────────────────────────

const PolicyQualitySchema = z.object({
  pass: z.boolean().describe("true if the policy is substantive and complete"),
  reason: z.string().describe("One-sentence explanation"),
  missingElements: z.array(z.string()).describe("Missing policy elements"),
});

export type PolicyQualityResult = z.infer<typeof PolicyQualitySchema>;

// ---------------------------------------------------------------------------
// cleanPolicyText
// ---------------------------------------------------------------------------
// Safely cleans HTML tags, entities, and whitespace from legal policy text
// WITHOUT stripping English words like 'return', 'condition', etc.
// ---------------------------------------------------------------------------
export function cleanPolicyText(raw: string): string {
  if (!raw) return "";
  let text = raw.replace(/\r\n?/g, "\n");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n\n").trim();
  return text;
}

// ---------------------------------------------------------------------------
// extractRelevantPolicyText
// ---------------------------------------------------------------------------
// Extracts compliance-critical sections from refund policies (timeframes,
// item conditions, fees, shipping, exceptions) while dropping boilerplate.
// ---------------------------------------------------------------------------
export function extractRelevantPolicyText(raw: string, maxChars = 4000): string {
  if (!raw) return "";

  const cleaned = cleanPolicyText(raw);
  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  // Split into paragraphs; fallback to sentence boundaries if page is single-block
  let units = cleaned
    .split(/\n+/)
    .map((u) => u.trim())
    .filter(Boolean);

  if (units.length <= 2) {
    units = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
  }

  const keywords = [
    "day",
    "days",
    "timeframe",
    "window",
    "month",
    "week",
    "return",
    "returns",
    "refund",
    "refunds",
    "exchange",
    "exchanges",
    "condition",
    "unused",
    "unworn",
    "unopened",
    "original packaging",
    "packaging",
    "tag",
    "tags",
    "receipt",
    "proof of purchase",
    "eligib",
    "shipping",
    "postage",
    "label",
    "fee",
    "fees",
    "restock",
    "cost",
    "damage",
    "damaged",
    "defect",
    "defective",
    "non-returnable",
    "final sale",
  ];

  const matched: string[] = [];
  let totalLength = 0;

  for (const unit of units) {
    const lower = unit.toLowerCase();
    const isRelevant = keywords.some((kw) => lower.includes(kw));

    if (isRelevant) {
      if (totalLength + unit.length > maxChars) {
        const remaining = maxChars - totalLength;
        if (remaining > 60) {
          matched.push(unit.slice(0, remaining));
        }
        break;
      }
      matched.push(unit);
      totalLength += unit.length + 2;
    }
  }

  // If keyword filtering matched nothing, return the beginning of the cleaned text
  if (matched.length === 0) {
    return cleaned.slice(0, maxChars);
  }

  return matched.join("\n\n");
}

export async function checkPolicyQuality(policyText: string): Promise<PolicyQualityResult> {
  const fallbackCheck = () => {
    const text = policyText.toLowerCase();
    const hasTimeframe =
      /\b(\d{1,3}[\s-]*(day|days|business days|calendar days|working days|month|months|week|weeks))\b/i.test(text) ||
      text.includes("return window") ||
      text.includes("return period") ||
      text.includes("timeframe") ||
      text.includes("within 30") ||
      text.includes("within 14");
    const hasConditions =
      text.includes("condition") ||
      text.includes("unused") ||
      text.includes("unworn") ||
      text.includes("unopened") ||
      text.includes("original packaging") ||
      text.includes("packaging") ||
      text.includes("tag") ||
      text.includes("proof of purchase") ||
      text.includes("receipt");
    const wordCount = text.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    const pass = hasTimeframe && hasConditions && wordCount >= 30;
    const missing: string[] = [];
    if (!hasTimeframe) missing.push("return timeframe");
    if (!hasConditions) missing.push("item conditions");
    if (wordCount < 30) missing.push("substantive text (at least 30 words)");
    return {
      pass,
      reason: pass
        ? "Policy contains required return timeframe and condition disclosures"
        : `Policy missing ${missing.join(" or ")}`,
      missingElements: pass ? [] : (missing.length > 0 ? missing : ["return timeframe", "item conditions"]),
    };
  };
  

  const model = getModel();
  if (!model) {
    console.log("[AI-Check 2] No OPENROUTER_API_KEY — using keyword fallback");
    return fallbackCheck();
  }

  try {
    const structured = model.withStructuredOutput(PolicyQualitySchema);
    console.log("[AI-Check 2] Evaluating refund policy quality via GPT-4o-mini");

    const focusedPolicyText = extractRelevantPolicyText(policyText, 4000);

    // 🔍 DEBUG: write policy text to file for inspection
   
    console.log("[AI-Check 2] Focused policy text (first 500 chars):", focusedPolicyText.slice(0, 500));

    const result = await withTimeout(
      structured.invoke([
        {
          role: "system",
          content: `You are a Google Merchant Center and Shopify compliance auditor.
Evaluate the refund/return policy against these mandatory requirements:
1. A concrete return window must be stated (e.g. "within 30 days", "14 business days")
2. Return item conditions must be specified (e.g. unused, original packaging, tags attached)
3. The policy must NOT be a blank template or fewer than 50 meaningful words
4. Ideally states who pays return shipping costs
Be strict but fair. A policy mentioning "30 days" and "unused" is sufficient to pass.`,
        },
        { role: "user", content: `Refund policy text:\n\n${focusedPolicyText}` },
      ]) as Promise<PolicyQualityResult>,
      AI_TIMEOUT_MS,
      fallbackCheck()
    );

    console.log("[AI-Check 2] Result:", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(
      "[AI-Check 2] AI evaluation failed, falling back to rule check:",
      (err as Error)?.message || err
    );
    return fallbackCheck();
  }
}

// ─────────────────────────────────────────────────────────────────
// CHECK 9 — Physical Address Detection
// ─────────────────────────────────────────────────────────────────

const AddressDetectionSchema = z.object({
  pass: z.boolean().describe("true if a physical address is present in the text"),
  detectedAddress: z.string().describe("The exact address string found, or empty string"),
  reason: z.string().describe("Brief explanation of the detection result"),
});

export type AddressDetectionResult = z.infer<typeof AddressDetectionSchema>;

export async function checkPhysicalAddress(pageText: string): Promise<AddressDetectionResult> {

  let newText: string = preparePageText(pageText);
  // try {
  //   const contactFilePath = path.join(os.tmpdir(), "complyguard-contact-page.txt");
  //   await fs.writeFile(contactFilePath, newText, "utf-8");
  // } catch (err) {
  //   console.error("Failed to save contact-page debug file:", err);
  // }
  const fallbackCheck = () => {
    const ADDRESS_TERMS = [
      "street", " st.", "road", " rd.", "avenue", " ave.",
      "boulevard", " blvd.", "suite", " ste.", "floor",
      "building", "po box", "postal code", "zip code",
    ];
    const text = pageText.toLowerCase();
    const pass = ADDRESS_TERMS.some((t) => text.includes(t));
    return {
      pass,
      detectedAddress: "",
      reason: pass ? "[Fall back] Physical address detected on storefront" : "[Fall back] No physical business address detected on storefront",
    };
  };

  const model = getModel();
  if (!model) {
    console.log("[AI-Check 9] No OPENROUTER_API_KEY — using keyword fallback");
    return fallbackCheck();
  }

  try {
    const structured = model.withStructuredOutput(AddressDetectionSchema);
    console.log("[AI-Check 9] Detecting physical address via GPT-4o-mini");

    const result = await withTimeout(
      structured.invoke([
        {
          role: "system",
          content: `You are a named entity recognition system specialising in detecting physical business addresses.
Scan the webpage text and determine whether a physical mailing or business location address exists.
A valid address includes a street number, street name, city, and optionally a postal/zip code or country.
PO Box addresses also count. Do NOT count email addresses or URLs.`,
        },
        { role: "user", content: `Webpage text:\n\n${newText.slice(0, 4000)}` },
      ]) as Promise<AddressDetectionResult>,
      AI_TIMEOUT_MS,
      fallbackCheck()
    );

    console.log("[AI-Check 9] Result:", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(
      "[AI-Check 9] AI evaluation failed, falling back to rule check:",
      (err as Error)?.message || err
    );
    return fallbackCheck();
  }
}

// ─────────────────────────────────────────────────────────────────
// CHECK 15 — Risky / Deceptive Product Claims
// ─────────────────────────────────────────────────────────────────

const ProductClaimsSchema = z.object({
  pass: z.boolean().describe("true if no deceptive claims were found"),
  flagged: z
    .array(
      z.object({
        product: z.string().describe("Product title"),
        claim: z.string().describe("The problematic claim or phrase"),
        violationType: z
          .string()
          .describe("medical_claim | unverifiable_guarantee | competitor_disparagement | deceptive_pricing | prohibited_product"),
      })
    )
    .describe("List of flagged products and their problematic claims"),
  reason: z.string().describe("Summary of findings"),
});

export type ProductClaimsResult = z.infer<typeof ProductClaimsSchema>;

export async function checkProductClaims(
  products: { title: string; description: string }[]
): Promise<ProductClaimsResult> {
  if (products.length === 0) {
    return { pass: true, flagged: [], reason: "No products to scan" };
  }

const fallbackCheck = () => {
    const RISKY = [
      "best deal ever", "lowest price guaranteed", "miracle cure",
      "100% cure", "unbeatable price", "number 1 in the world",
      "cheapest on the internet", "guaranteed weight loss",
      "risk free", "100% satisfaction guaranteed",
    ];
    const flagged: { product: string; claim: string; violationType: string }[] = [];
    for (const p of products) {
      const text = `${p.title} ${p.description}`.toLowerCase();
      for (const term of RISKY) {
        if (text.includes(term)) {
          flagged.push({ product: p.title, claim: term, violationType: "unverifiable_guarantee" });
          break;
        }
      }
    }
    return {
      pass: flagged.length === 0,
      flagged,
      reason: flagged.length === 0
        ? "No unverifiable claims detected in products"
        : `${flagged.length} product(s) flagged for unverifiable claims`,
    };
  };

  const model = getModel();
  if (!model) {
    console.log("[AI-Check 15] No OPENROUTER_API_KEY — using keyword fallback");
    return fallbackCheck();
  }

  try {
    const sampleProducts = products.slice(0, 8);
    console.log(`[AI-Check 15] Scanning ${sampleProducts.length} products via GPT-4o-mini`);

    const productList = sampleProducts
      .map(
        (p, i) =>
          `[${i + 1}] Title: ${p.title}\nDescription: ${p.description.replace(/<[^>]+>/g, " ").slice(0, 200)}`
      )
      .join("\n\n");
    const structured = model.withStructuredOutput(ProductClaimsSchema);
    const result = await withTimeout(
      structured.invoke([
        {
          role: "system",
          content: `You are a Google Merchant Center and Shopify AUP policy enforcer.
Scan the product listings for policy violations:
- Unverifiable guarantees ("100% satisfaction", "best in the world", "guaranteed weight loss")
- Medical/health claims ("cures", "treats", "clinically proven" without evidence)
- Competitor disparagement ("better than X", "unlike cheap competitors")
- Deceptive pricing ("50% off forever", "was $1000 now $10")
- Prohibited content described misleadingly

Flag only genuine violations. Do not flag normal product descriptions.`,
        },
        { role: "user", content: `Product listings:\n\n${productList}` },
      ]) as Promise<ProductClaimsResult>,
      AI_TIMEOUT_MS,
      fallbackCheck()
    );

    console.log(`[AI-Check 15] Result: pass=${result.pass}, flagged=${result.flagged.length}`);
    return result;
  } catch (err) {
    console.error(
      "[AI-Check 15] AI evaluation failed, falling back to rule check:",
      (err as Error)?.message || err
    );
    return fallbackCheck();
  }
}

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
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// Shared LangChain model factory
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

function getModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  const modelName = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";

  return new ChatOpenAI({
    model: modelName,
    temperature: 0,
    apiKey: apiKey,
    maxTokens: 800,
    timeout: 12000,
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

export async function checkPolicyQuality(policyText: string): Promise<PolicyQualityResult> {
  const fallbackCheck = () => {
    const text = policyText.toLowerCase();
    const hasTimeframe =
      /\b(\d{1,3}\s*(day|days|business days|month|weeks))\b/i.test(text) ||
      text.includes("return window");
    const hasConditions =
      text.includes("condition") ||
      text.includes("unused") ||
      text.includes("original packaging");
    const pass = hasTimeframe && hasConditions && text.split(/\s+/).length >= 50;
    return {
      pass,
      reason: pass
        ? "Policy contains required return timeframe and condition disclosures"
        : "Policy missing return timeframe or product condition requirements",
      missingElements: pass ? [] : ["return timeframe", "item conditions"],
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
        { role: "user", content: `Refund policy text:\n\n${policyText.slice(0, 3000)}` },
      ]) as Promise<PolicyQualityResult>,
      12000,
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
      reason: pass ? "Physical address detected on storefront" : "No physical business address detected on storefront",
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
        { role: "user", content: `Webpage text:\n\n${pageText.slice(0, 4000)}` },
      ]) as Promise<AddressDetectionResult>,
      12000,
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
      12000,
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

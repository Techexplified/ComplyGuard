import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { OnboardingStep1 } from "../components/OnboardingStep1";
import { OnboardingStep2 } from "../components/OnboardingStep2";
import { OnboardingStep3 } from "../components/OnboardingStep3";

async function checkIsStorefrontPasswordProtected(
  shopDomain: string,
  admin?: { graphql: (query: string, options?: Record<string, unknown>) => Promise<Response> }
): Promise<boolean> {
  // 1. Try GraphQL if admin client is provided
  if (admin) {
    try {
      const gqlRes = await admin.graphql(`
        query CheckPasswordProtection {
          shop {
            passwordProtection {
              enabled
            }
          }
        }
      `);
      if (gqlRes.ok) {
        const json = await gqlRes.json();
        if (typeof json?.data?.shop?.passwordProtection?.enabled === "boolean") {
          return json.data.shop.passwordProtection.enabled;
        }
      }
    } catch {
      // Fall through to HTTP check
    }
  }

  // 2. Direct storefront HTTP check
  try {
    const res = await fetch(`https://${shopDomain}`, {
      headers: { "User-Agent": "ComplyGuard-Audit/1.0" },
      signal: AbortSignal.timeout(3500),
      redirect: "follow",
    });
    if (res.url.includes("/password")) {
      return true;
    }
    const html = await res.text();
    return (
      html.includes('name="password"') ||
      html.includes('/password') ||
      html.toLowerCase().includes("opening soon") ||
      html.toLowerCase().includes("password-page") ||
      html.toLowerCase().includes("template-password") ||
      html.toLowerCase().includes("storefront-password")
    );
  } catch (err) {
    console.warn(`[PasswordCheck] Error checking https://${shopDomain}:`, err);
    return false;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  const url = new URL(request.url);

  // If onboarding is already completed, redirect to the main page
  if (shopRecord?.onBoarding) {
    return redirect(`/app${url.search}`);
  }

  const isPasswordProtected = await checkIsStorefrontPasswordProtected(shopDomain, admin);

  return { shop: shopDomain, isPasswordProtected };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "check_lock") {
    const isPasswordProtected = await checkIsStorefrontPasswordProtected(shopDomain, admin);
    return { isPasswordProtected, checkedAt: Date.now() };
  }

  // Completing onboarding / initiating first scan:
  // Server-side validation: block if storefront is password-protected
  const isPasswordProtected = await checkIsStorefrontPasswordProtected(shopDomain, admin);
  if (isPasswordProtected) {
    return {
      error: "Your storefront is currently locked behind a password. Please remove password protection in Online Store > Preferences to proceed.",
      isPasswordProtected: true,
    };
  }

  await prisma.shop.upsert({
    where: { shopDomain },
    update: { onBoarding: true },
    create: {
      id: session.shop,
      shopDomain: session.shop,
      accessToken: session.accessToken || "",
      onBoarding: true,
    },
  });

  const url = new URL(request.url);
  return redirect(`/app/scanning${url.search}`);
};

export default function OnboardingPage() {
  const data = useLoaderData<typeof loader>();
  const shop = data?.shop ?? "";
  const [currentStep, setCurrentStep] = useState(1);
  const finishFetcher = useFetcher();
  const lockFetcher = useFetcher();

  // Prefer lockFetcher response if available, then finishFetcher error state, then loader data
  const isPasswordProtected =
    lockFetcher.data?.isPasswordProtected !== undefined
      ? Boolean(lockFetcher.data.isPasswordProtected)
      : finishFetcher.data?.isPasswordProtected !== undefined
      ? Boolean(finishFetcher.data.isPasswordProtected)
      : Boolean(data?.isPasswordProtected);

  const isCheckingLock = ["loading", "submitting"].includes(lockFetcher.state);
  const isSubmitting = ["loading", "submitting"].includes(finishFetcher.state);
  const errorMessage = finishFetcher.data?.error || null;

  const handleFinishOnboarding = () => {
    finishFetcher.submit({ intent: "finish_onboarding" }, { method: "POST" });
  };

  const handleRecheckLock = () => {
    lockFetcher.submit({ intent: "check_lock" }, { method: "POST" });
  };

  const handleGoToStep3 = () => {
    setCurrentStep(3);
    // Refresh storefront lock status when moving to step 3
    lockFetcher.submit({ intent: "check_lock" }, { method: "POST" });
  };

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-zinc-900 flex flex-col items-center justify-start p-4 sm:p-6 antialiased font-sans">
      <div className="w-full max-w-270 bg-white rounded-2xl overflow-hidden border border-zinc-200 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08),0_4px_6px_-2px_rgba(0,0,0,0.03)]">
        {/* Persistent Top Header & Dynamic Stepper without Logo */}
        <header className="bg-[#17171a] h-17 flex items-center justify-between px-6 sm:px-8 text-white">
          <nav
            className="flex items-center gap-3 sm:gap-4"
            aria-label="Onboarding Progress"
          >
            {/* Step 1 */}
            <div
              className={`flex items-center gap-2.5 text-sm font-semibold transition-colors ${
                currentStep >= 1 ? "text-white" : "text-zinc-400"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  currentStep >= 1
                    ? "bg-[#f05423] text-white"
                    : "bg-[#27272a] text-zinc-400"
                }`}
              >
                1
              </div>
              <span>What it does</span>
            </div>

            <div className="w-8 sm:w-14 h-px bg-[#333338]" />

            {/* Step 2 */}
            <div
              className={`flex items-center gap-2.5 text-sm transition-colors ${
                currentStep >= 2
                  ? "text-white font-semibold"
                  : "text-zinc-400 font-medium"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  currentStep >= 2
                    ? "bg-[#f05423] text-white"
                    : "bg-[#27272a] text-zinc-400 border border-zinc-700/60"
                }`}
              >
                2
              </div>
              <span>Enable embed</span>
            </div>

            <div className="w-8 sm:w-14 h-px bg-[#333338]" />

            {/* Step 3 */}
            <div
              className={`flex items-center gap-2.5 text-sm transition-colors ${
                currentStep >= 3
                  ? "text-white font-semibold"
                  : "text-zinc-400 font-medium"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  currentStep >= 3
                    ? "bg-[#f05423] text-white"
                    : "bg-[#27272a] text-zinc-400 border border-zinc-700/60"
                }`}
              >
                3
              </div>
              <span>First scan</span>
            </div>
          </nav>

          {/* Dynamic Step Counter */}
          <div className="text-[11px] font-semibold tracking-widest text-zinc-400 uppercase">
            STEP {currentStep} OF 3
          </div>
        </header>

        {/* Step 1 Content */}
        {currentStep === 1 && (
          <OnboardingStep1 onContinue={() => setCurrentStep(2)} />
        )}

        {/* Step 2 Content */}
        {currentStep === 2 && (
          <OnboardingStep2
            shopDomain={shop}
            onBack={() => setCurrentStep(1)}
            onContinue={handleGoToStep3}
          />
        )}

        {/* Step 3 Content */}
        {currentStep === 3 && (
          <OnboardingStep3
            onBack={() => setCurrentStep(2)}
            onScan={handleFinishOnboarding}
            isScanning={isSubmitting}
            shopDomain={shop}
            isPasswordProtected={isPasswordProtected}
            isCheckingLock={isCheckingLock}
            onRecheckLock={handleRecheckLock}
            errorMessage={errorMessage}
          />
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
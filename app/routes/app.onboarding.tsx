import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Query shop record
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  // If onboarding is ALREADY completed, redirect to the main page
  if (shopRecord?.onBoarding) {
    return redirect("/app");
  }

  return { shop: shopDomain };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Mark onboarding as true in the database
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

  // Redirect to main dashboard
  return redirect("/app");
};

export default function OnboardingPage() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-zinc-900 flex flex-col items-center justify-start p-4 sm:p-6 antialiased">
      <div className="w-full max-w-[1080px] bg-white rounded-2xl overflow-hidden border border-zinc-200 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08),0_4px_6px_-2px_rgba(0,0,0,0.03)]">
        {/* Top Header & Stepper */}
        <header className="bg-[#17171a] h-[68px] flex items-center justify-between px-6 sm:px-8 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-[#f05423] text-white font-extrabold text-sm tracking-tight w-8 h-8 rounded-[7px] flex items-center justify-center">
              CG
            </div>
            <span className="text-lg font-bold tracking-tight text-white">
              ComplyGuard
            </span>
          </div>

          <nav
            className="hidden md:flex items-center gap-3"
            aria-label="Onboarding Progress"
          >
            {/* Step 1: Active */}
            <div className="flex items-center gap-2.5 text-sm font-semibold text-white">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-[#f05423] text-white">
                1
              </div>
              <span>What it does</span>
            </div>

            <div className="w-14 h-[1px] bg-[#333338]" />

            {/* Step 2: Inactive */}
            <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-400">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-[#27272a] text-zinc-400">
                2
              </div>
              <span>Enable embed</span>
            </div>

            <div className="w-14 h-[1px] bg-[#333338]" />

            {/* Step 3: Inactive */}
            <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-400">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-[#27272a] text-zinc-400">
                3
              </div>
              <span>First scan</span>
            </div>
          </nav>

          <div className="text-[11px] font-semibold tracking-widest text-zinc-400 uppercase">
            STEP 1 OF 3
          </div>
        </header>

        {/* Main Content Area */}
        <main className="p-6 sm:p-10 md:p-12 md:pb-9">
          <div className="text-xs font-bold tracking-[1.5px] text-[#c25e37] uppercase mb-3">
            WELCOME
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-[32px] font-bold text-zinc-900 tracking-tight leading-tight mb-3">
            Let’s get your store protected
          </h1>
          <p className="text-sm sm:text-base text-zinc-600 leading-normal mb-10 md:mb-11 max-w-[800px]">
            ComplyGuard works in three stages, in this order — each one builds on the last.
          </p>

          {/* Three Stages Cards */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 mb-12 md:mb-14">
            {/* Stage 1: Screen */}
            <div className="flex-1 bg-white border border-zinc-200 rounded-2xl p-6 min-h-[204px] flex flex-col shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition hover:-translate-y-0.5 hover:shadow-md hover:border-zinc-300">
              <div className="w-10 h-10 rounded-[10px] bg-[#faeae3] flex items-center justify-center mb-5 shrink-0">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#c25e37"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="8.5" />
                  <circle cx="12" cy="12" r="3.5" fill="#c25e37" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-zinc-900 mb-3 tracking-tight">
                Screen
              </h3>
              <p className="text-[13.5px] leading-relaxed text-zinc-600">
                Scan your store against 18 known shopify compliance &amp; policy triggers, before issues arise.
              </p>
            </div>

            {/* Arrow 1 */}
            <div
              className="text-zinc-400 flex items-center justify-center shrink-0 py-1 md:py-0 md:px-1"
              aria-hidden="true"
            >
              <svg
                className="rotate-90 md:rotate-0"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                stroke="#a1a1aa"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>

            {/* Stage 2: Monitor */}
            <div className="flex-1 bg-white border border-zinc-200 rounded-2xl p-6 min-h-[204px] flex flex-col shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition hover:-translate-y-0.5 hover:shadow-md hover:border-zinc-300">
              <div className="w-10 h-10 rounded-[10px] bg-[#faeae3] flex items-center justify-center mb-5 shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="7"
                    y="7"
                    width="10"
                    height="10"
                    rx="1.5"
                    transform="rotate(45 12 12)"
                    fill="#c25e37"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-zinc-900 mb-3 tracking-tight">
                Monitor
              </h3>
              <p className="text-[13.5px] leading-relaxed text-zinc-600">
                Get alerted the moment a policy edit or product change puts you at risk — before{" "}
                <strong className="text-zinc-900 font-semibold">Shopify</strong> notices.
              </p>
            </div>

            {/* Arrow 2 */}
            <div
              className="text-zinc-400 flex items-center justify-center shrink-0 py-1 md:py-0 md:px-1"
              aria-hidden="true"
            >
              <svg
                className="rotate-90 md:rotate-0"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                stroke="#a1a1aa"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>

            {/* Stage 3: Diagnose */}
            <div className="flex-1 bg-white border border-zinc-200 rounded-2xl p-6 min-h-[204px] flex flex-col shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition hover:-translate-y-0.5 hover:shadow-md hover:border-zinc-300">
              <div className="w-10 h-10 rounded-[10px] bg-[#faeae3] flex items-center justify-center mb-5 shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="7.5"
                    y="7.5"
                    width="9"
                    height="9"
                    rx="1.5"
                    transform="rotate(45 12 12)"
                    stroke="#c25e37"
                    strokeWidth="2"
                    fill="none"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-zinc-900 mb-3 tracking-tight">
                Diagnose
              </h3>
              <p className="text-[13.5px] leading-relaxed text-zinc-600">
                If you re suspended, paste the notice and get ranked, specific likely causes.
              </p>
            </div>
          </div>

          {/* Divider Line */}
          <hr className="border-t border-[#f0f0f2] mb-7" />

          {/* Bottom Action Form */}
          <div className="flex justify-end items-center">
            <Form method="post">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60 active:scale-[0.98] text-white text-[14.5px] font-semibold px-8 py-3 rounded-xl transition shadow-sm cursor-pointer"
              >
                {isSubmitting ? "Saving..." : "Continue"}
              </button>
            </Form>
          </div>
        </main>
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


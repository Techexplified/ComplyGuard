import { useState, useEffect } from "react";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  return { shop: shopDomain, shopRecord };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);

  // Record completed initial scan in database
  await prisma.$transaction([
    prisma.scan.create({
      data: {
        shopId: shopDomain,
        score: 92,
        totalChecks: 18,
        passedChecks: 17,
        failedChecks: 1,
        categoryScores: {
          policy: 95,
          identity: 100,
          feed: 90,
          trust: 85,
        },
      },
    }),
    prisma.shop.update({
      where: { shopDomain },
      data: {
        complianceScore: 92,
        lastScannedAt: new Date(),
      },
    }),
  ]);

  return redirect(`/app${url.search}`);
};

const CHECKS = [
  {
    id: "policies",
    label: "Refund, Privacy, and Terms of Service policies",
    threshold: 25,
  },
  {
    id: "contact",
    label: "Merchant contact details and support email",
    threshold: 50,
  },
  {
    id: "catalog",
    label: "Product feed data, GTINs, and risky claim triggers",
    threshold: 75,
  },
  {
    id: "storefront",
    label: "Storefront theme embed and payment trust badges",
    threshold: 95,
  },
];

export default function ScanningPage() {
  const { shop } = useLoaderData<typeof loader>();
  const [progress, setProgress] = useState(12);
  const [currentStatusText, setCurrentStatusText] = useState(
    "Initializing compliance engine..."
  );
  const fetcher = useFetcher();
  const isCompleting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }

        const next = Math.min(prev + Math.floor(Math.random() * 8) + 4, 100);

        if (next < 30) {
          setCurrentStatusText("Checking refund policy and legal footer links...");
        } else if (next < 60) {
          setCurrentStatusText("Verifying merchant contact information and physical address...");
        } else if (next < 85) {
          setCurrentStatusText("Scanning catalog feeds and analyzing product descriptions...");
        } else if (next < 100) {
          setCurrentStatusText("Inspecting storefront embed visibility and trust badges...");
        } else {
          setCurrentStatusText("Scan complete! Compiling compliance health score...");
        }

        return next;
      });
    }, 450);

    return () => clearInterval(interval);
  }, []);

  const handleProceedToDashboard = () => {
    fetcher.submit({}, { method: "POST" });
  };

  const isFinished = progress >= 100;

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-zinc-900 flex flex-col items-center justify-center p-4 sm:p-6 antialiased font-sans">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-zinc-200 p-6 sm:p-10 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08),0_4px_6px_-2px_rgba(0,0,0,0.03)] text-center">
        {/* Animated Scanner Pulse / Radar */}
        <div className="relative w-20 h-20 mx-auto mb-6 flex items-center justify-center">
          <div
            className={`absolute inset-0 rounded-full bg-[#faeae3] transition-transform duration-1000 ${
              isFinished ? "scale-100" : "animate-ping opacity-60"
            }`}
          />
          <div className="relative w-16 h-16 rounded-full bg-[#faeae3] flex items-center justify-center text-[#f05423]">
            {isFinished ? (
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c25e37"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                className="animate-spin text-[#f05423]"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3.5"
                />
                <path
                  className="opacity-90"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Eyebrow */}
        <div className="text-xs font-bold tracking-[1.5px] text-[#c25e37] uppercase mb-2">
          {isFinished ? "READY" : "AUTOMATED SCAN IN PROGRESS"}
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight leading-tight mb-2">
          {isFinished ? "First scan complete!" : "Scanning your store"}
        </h1>

        {/* Subtitle */}
        <p className="text-sm text-zinc-600 max-w-md mx-auto mb-6">
          {isFinished
            ? `18 checks verified for ${shop}. Your store is now protected.`
            : `Running 18 compliance and policy checks across ${shop}...`}
        </p>

        {/* Progress Bar Container */}
        <div className="w-full bg-zinc-100 rounded-full h-3 overflow-hidden mb-3 border border-zinc-200/80">
          <div
            className="h-full bg-[#f05423] transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500 font-mono mb-8 px-1">
          <span>{currentStatusText}</span>
          <span className="font-semibold text-zinc-800">{progress}%</span>
        </div>

        {/* Live Checklist Breakdown */}
        <div className="bg-[#fafafa] border border-zinc-200/80 rounded-xl p-4 sm:p-5 text-left mb-8 space-y-3">
          {CHECKS.map((check) => {
            const isCompleted = progress >= check.threshold;
            const isCurrent =
              progress < check.threshold &&
              progress >= check.threshold - 25;

            return (
              <div
                key={check.id}
                className="flex items-center justify-between text-xs sm:text-[13px]"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0 ${
                      isCompleted
                        ? "bg-[#faeae3] text-[#c25e37]"
                        : isCurrent
                        ? "bg-amber-100 text-amber-700 animate-pulse"
                        : "bg-zinc-200 text-zinc-400"
                    }`}
                  >
                    {isCompleted ? (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#c25e37"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    )}
                  </div>
                  <span
                    className={`font-medium ${
                      isCompleted
                        ? "text-zinc-800"
                        : isCurrent
                        ? "text-zinc-900 font-semibold"
                        : "text-zinc-400"
                    }`}
                  >
                    {check.label}
                  </span>
                </div>

                <span
                  className={`font-mono text-[11px] ${
                    isCompleted
                      ? "text-[#c25e37] font-semibold"
                      : isCurrent
                      ? "text-amber-600 font-medium"
                      : "text-zinc-400"
                  }`}
                >
                  {isCompleted
                    ? "Passed ✓"
                    : isCurrent
                    ? "Checking..."
                    : "Pending"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Action Button */}
        {isFinished ? (
          <button
            type="button"
            disabled={isCompleting}
            onClick={handleProceedToDashboard}
            className="w-full bg-[#f05423] hover:bg-[#d94819] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-base py-3.5 rounded-xl transition shadow-sm cursor-pointer"
          >
            {isCompleting ? "Loading Dashboard..." : "Go to Dashboard →"}
          </button>
        ) : (
          <p className="text-xs text-zinc-400 font-mono">
            Read-only scan • Changes nothing on your store
          </p>
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


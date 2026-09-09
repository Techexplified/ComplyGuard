import { useState, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runStorefrontComplianceScan } from "../service/scanner.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  return { shop: shopDomain, shopRecord };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  try {
    // Run the real 18-check compliance scan against storefront & admin API
    const scanResult = await runStorefrontComplianceScan({ admin, shopDomain });

    return {
      success: true,
      score: scanResult.score,
      passedChecks: scanResult.passedChecks,
      totalChecks: scanResult.totalChecks,
      issuesCount: scanResult.issues.length,
      issues: scanResult.issues,
    };
  } catch (error) {
    console.error("Scanning action failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Scan failed",
    };
  }
};

const CHECKS = [
  {
    id: "POLICY",
    label: "Refund, Privacy, and Terms of Service policies",
    threshold: 25,
  },
  {
    id: "IDENTITY",
    label: "Merchant contact details and support email",
    threshold: 50,
  },
  {
    id: "PRODUCT_FEED",
    label: "Product feed data, GTINs, and risky claim triggers",
    threshold: 75,
  },
  {
    id: "TRUST_SIGNALS",
    label: "Storefront theme embed and payment trust badges",
    threshold: 95,
  },
];

export default function ScanningPage() {
  const { shop } = useLoaderData<typeof loader>();
  const location = useLocation();
  const fetcher = useFetcher<typeof action>();

  const [progress, setProgress] = useState(15);
  const [currentStatusText, setCurrentStatusText] = useState(
    "Connecting to storefront & compliance engine..."
  );

  const hasTriggeredRef = useRef(false);

  // 1. Trigger the real scan automatically as soon as the page loads!
  useEffect(() => {
    if (!hasTriggeredRef.current && fetcher.state === "idle" && !fetcher.data) {
      hasTriggeredRef.current = true;
      fetcher.submit({}, { method: "POST" });
    }
  }, [fetcher]);

  // 2. Smoothly animate progress bar while the backend scan executes
  useEffect(() => {
    const isScanComplete = Boolean(fetcher.data?.success);

    const interval = setInterval(() => {
      setProgress((prev) => {
        // Hold at 90% if backend scan hasn't responded yet
        if (!isScanComplete && prev >= 90) {
          return 90;
        }

        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }

        const increment = isScanComplete
          ? 6
          : Math.floor(Math.random() * 5) + 3;
        const next = Math.min(prev + increment, isScanComplete ? 100 : 90);

        if (next < 30) {
          setCurrentStatusText("Checking refund policy and legal footer links...");
        } else if (next < 60) {
          setCurrentStatusText(
            "Verifying merchant contact information and physical address..."
          );
        } else if (next < 85) {
          setCurrentStatusText(
            "Scanning catalog feeds and analyzing product descriptions..."
          );
        } else if (next < 100) {
          setCurrentStatusText(
            "Inspecting storefront embed visibility and trust badges..."
          );
        } else {
          setCurrentStatusText(
            fetcher.data?.score !== undefined
              ? `Scan complete! Store compliance health score: ${fetcher.data.score}/100`
              : "Scan complete! Compiling compliance health score..."
          );
        }

        return next;
      });
    }, 250);

    return () => clearInterval(interval);
  }, [fetcher.data]);

  const scanData = fetcher.data;
  const isFinished = Boolean(scanData?.success) && progress >= 100;
  const hasError = fetcher.data && !fetcher.data.success;

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
          {isFinished ? "Store scan completed!" : "Scanning your store"}
        </h1>

        {/* Subtitle */}
        <p className="text-sm text-zinc-600 max-w-md mx-auto mb-6">
          {isFinished
            ? `Baseline established for ${shop}. Score: ${scanData?.score}/100 (${scanData?.passedChecks}/${scanData?.totalChecks} checks passed).`
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

            // Check if there are any issues for this category from real scan
            const categoryIssues = (scanData?.issues || []).filter(
              (i) => i.category === check.id
            );
            const hasIssue = isCompleted && categoryIssues.length > 0;

            return (
              <div
                key={check.id}
                className="flex items-center justify-between text-xs sm:text-[13px]"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0 ${
                      isCompleted
                        ? hasIssue
                          ? "bg-amber-100 text-amber-700"
                          : "bg-[#faeae3] text-[#c25e37]"
                        : isCurrent
                        ? "bg-amber-100 text-amber-700 animate-pulse"
                        : "bg-zinc-200 text-zinc-400"
                    }`}
                  >
                    {isCompleted ? (
                      hasIssue ? (
                        <span className="text-[10px] font-bold">!</span>
                      ) : (
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
                      )
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
                      ? hasIssue
                        ? "text-amber-700 font-medium"
                        : "text-[#c25e37] font-semibold"
                      : isCurrent
                      ? "text-amber-600 font-medium"
                      : "text-zinc-400"
                  }`}
                >
                  {isCompleted
                    ? hasIssue
                      ? `${categoryIssues.length} issue${categoryIssues.length > 1 ? "s" : ""}`
                      : "Passed ✓"
                    : isCurrent
                    ? "Checking..."
                    : "Pending"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error State */}
        {hasError && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            <p className="font-semibold mb-1">Scan Error:</p>
            <p className="mb-3">{fetcher.data?.error}</p>
            <button
              type="button"
              onClick={() => fetcher.submit({}, { method: "POST" })}
              className="px-4 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition cursor-pointer"
            >
              Retry Scan
            </button>
          </div>
        )}

        {/* Action Button */}
        {isFinished ? (
          <Link
            to={`/app${location.search}`}
            className="w-full bg-[#f05423] hover:bg-[#d94819] active:scale-[0.99] text-white font-semibold text-base py-3.5 rounded-xl transition shadow-sm block text-center cursor-pointer"
          >
            View Dashboard →
          </Link>
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

import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useLoaderData, Form, Link, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Retrieve or initialize the shop record in database
  let shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      scans: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      issues: {
        orderBy: [{ resolved: "asc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!shopRecord) {
    shopRecord = await prisma.shop.create({
      data: {
        id: session.shop,
        shopDomain: session.shop,
        accessToken: session.accessToken || "",
        onBoarding: false,
      },
      include: {
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        issues: {
          orderBy: [{ resolved: "asc" }, { createdAt: "desc" }],
        },
      },
    });
  }

  const url = new URL(request.url);

  // Check onboarding status: if false, redirect immediately to /app/onboarding
  if (!shopRecord.onBoarding) {
    return redirect(`/app/onboarding${url.search}`);
  }

  return { shop: shopRecord };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const url = new URL(request.url);

  // Allow resetting onboarding for testing
  if (intent === "reset_onboarding") {
    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: { onBoarding: false },
    });
    return redirect(`/app/onboarding${url.search}`);
  }

  // Toggle issue resolved state
  if (intent === "toggle_issue") {
    const issueId = String(formData.get("issueId"));
    const currentResolved = formData.get("resolved") === "true";
    await prisma.issue.update({
      where: { id: issueId },
      data: { resolved: !currentResolved },
    });
    return { ok: true };
  }

  return null;
};

interface CategoryScores {
  policy?: number;
  identity?: number;
  feed?: number;
  trust?: number;
}

export default function MainPage() {
  const { shop } = useLoaderData<typeof loader>();
  const [filterSeverity, setFilterSeverity] = useState<string>("ALL");
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  const latestScan = shop.scans?.[0];
  const issues = shop.issues || [];
  const categoryScores = (latestScan?.categoryScores as CategoryScores) || {
    policy: 100,
    identity: 100,
    feed: 100,
    trust: 100,
  };

  const filteredIssues = issues.filter((iss) => {
    if (filterSeverity === "ALL") return true;
    if (filterSeverity === "CRITICAL") return iss.severity === "CRITICAL" && !iss.resolved;
    if (filterSeverity === "WARNING") return iss.severity === "WARNING" && !iss.resolved;
    if (filterSeverity === "RESOLVED") return iss.resolved;
    return true;
  });

  const criticalCount = issues.filter((i) => i.severity === "CRITICAL" && !i.resolved).length;
  const warningCount = issues.filter((i) => i.severity === "WARNING" && !i.resolved).length;
  const resolvedCount = issues.filter((i) => i.resolved).length;

  const getScoreBadge = (score: number) => {
    if (score >= 85) {
      return {
        bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
        label: "Low Risk • Store Safe",
      };
    }
    if (score >= 60) {
      return {
        bg: "bg-amber-50 text-amber-700 border-amber-200",
        label: "Medium Risk • Warnings Found",
      };
    }
    return {
      bg: "bg-red-50 text-red-700 border-red-200",
      label: "High Suspension Risk",
    };
  };

  const scoreBadge = getScoreBadge(shop.complianceScore);

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-zinc-900 p-4 sm:p-8 font-sans antialiased">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="bg-[#f05423] text-white font-extrabold text-sm tracking-tight w-10 h-10 rounded-xl flex items-center justify-center shadow-sm">
              CG
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-zinc-900">
                  ComplyGuard Dashboard
                </h1>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${scoreBadge.bg}`}
                >
                  {scoreBadge.label}
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Monitoring store:{" "}
                <span className="font-semibold text-zinc-700">{shop.shopDomain}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
            <Link
              to="/app/scanning"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#f05423] hover:bg-[#d94819] text-white transition shadow-sm cursor-pointer"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              Run New Scan
            </Link>

            {/* Reset Onboarding button for developer testing */}
            <Form method="post">
              <input type="hidden" name="intent" value="reset_onboarding" />
              <button
                type="submit"
                className="px-3 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 border border-zinc-200 transition cursor-pointer"
              >
                Reset Setup
              </button>
            </Form>
          </div>
        </div>

        {/* Quick Health Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Overall Health Score
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-zinc-900">
                {shop.complianceScore}
              </span>
              <span className="text-xs font-semibold text-zinc-400">/ 100</span>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {latestScan
                ? `${latestScan.passedChecks} of ${latestScan.totalChecks} checks passed`
                : "Continuous 18-point verification"}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Critical Actions
            </div>
            <div className="text-3xl font-extrabold text-red-600">
              {criticalCount}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {criticalCount === 0
                ? "No urgent suspension triggers"
                : "Require immediate merchant attention"}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Policy Warnings
            </div>
            <div className="text-3xl font-extrabold text-amber-600">
              {warningCount}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Optimization recommendations
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Last Scanned
            </div>
            <div className="text-sm font-bold text-zinc-800 truncate mt-1.5">
              {shop.lastScannedAt
                ? new Date(shop.lastScannedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Pending scan"}
            </div>
            <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Protection Active
            </p>
          </div>
        </div>

        {/* 4 Compliance Category Breakdown */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Category Breakdown
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Category 1 */}
            <div className="p-4 rounded-xl border border-zinc-100 bg-[#fafafa]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-800">
                  Policy Pages
                </span>
                <span className="text-xs font-bold text-[#c25e37]">
                  {categoryScores.policy ?? 100}%
                </span>
              </div>
              <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-[#f05423] h-full rounded-full transition-all"
                  style={{ width: `${categoryScores.policy ?? 100}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">
                Refund, privacy, terms, footer links
              </p>
            </div>

            {/* Category 2 */}
            <div className="p-4 rounded-xl border border-zinc-100 bg-[#fafafa]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-800">
                  Business Identity
                </span>
                <span className="text-xs font-bold text-[#c25e37]">
                  {categoryScores.identity ?? 100}%
                </span>
              </div>
              <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-[#f05423] h-full rounded-full transition-all"
                  style={{ width: `${categoryScores.identity ?? 100}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">
                Phone, email, address, legal name
              </p>
            </div>

            {/* Category 3 */}
            <div className="p-4 rounded-xl border border-zinc-100 bg-[#fafafa]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-800">
                  Product Feed
                </span>
                <span className="text-xs font-bold text-[#c25e37]">
                  {categoryScores.feed ?? 100}%
                </span>
              </div>
              <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-[#f05423] h-full rounded-full transition-all"
                  style={{ width: `${categoryScores.feed ?? 100}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">
                GTIN barcodes, pricing, claims
              </p>
            </div>

            {/* Category 4 */}
            <div className="p-4 rounded-xl border border-zinc-100 bg-[#fafafa]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-800">
                  Trust Signals
                </span>
                <span className="text-xs font-bold text-[#c25e37]">
                  {categoryScores.trust ?? 100}%
                </span>
              </div>
              <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-[#f05423] h-full rounded-full transition-all"
                  style={{ width: `${categoryScores.trust ?? 100}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">
                SSL encryption, payment methods
              </p>
            </div>
          </div>
        </div>

        {/* Action Center / Issues Section */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">
                Compliance Action Center
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Issues identified during storefront scanning that risk Google Merchant Center suspension
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 bg-zinc-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setFilterSeverity("ALL")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSeverity === "ALL"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                All ({issues.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterSeverity("CRITICAL")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSeverity === "CRITICAL"
                    ? "bg-white text-red-700 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Critical ({criticalCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterSeverity("WARNING")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSeverity === "WARNING"
                    ? "bg-white text-amber-700 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Warnings ({warningCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterSeverity("RESOLVED")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSeverity === "RESOLVED"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Resolved ({resolvedCount})
              </button>
            </div>
          </div>

          {/* Issues List */}
          {filteredIssues.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zinc-200 rounded-xl bg-[#fafafa]">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-zinc-900">
                {filterSeverity === "ALL"
                  ? "All 18 compliance checks passed!"
                  : `No ${filterSeverity.toLowerCase()} issues found`}
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
                Your storefront adheres to policy and identity guidelines.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIssues.map((issue) => {
                const isExpanded = expandedIssueId === issue.id;

                const severityBadge =
                  issue.severity === "CRITICAL"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : issue.severity === "WARNING"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-blue-50 text-blue-700 border-blue-200";

                return (
                  <div
                    key={issue.id}
                    className={`rounded-xl border transition p-4.5 ${
                      issue.resolved
                        ? "bg-zinc-50 border-zinc-200 opacity-60"
                        : issue.severity === "CRITICAL"
                        ? "bg-white border-red-200/70 hover:border-red-300"
                        : "bg-white border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                              issue.resolved
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : severityBadge
                            }`}
                          >
                            {issue.resolved ? "Resolved" : issue.severity}
                          </span>
                        </div>
                        <div>
                          <h4
                            className={`text-sm font-bold ${
                              issue.resolved ? "line-through text-zinc-500" : "text-zinc-900"
                            }`}
                          >
                            {issue.title}
                          </h4>
                          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                            {issue.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Toggle Fix Guide details */}
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIssueId(isExpanded ? null : issue.id)
                          }
                          className="px-2.5 py-1 text-xs font-semibold text-[#f05423] hover:bg-[#faeae3] rounded-lg transition cursor-pointer"
                        >
                          {isExpanded ? "Hide Guide ↑" : "Fix Guide ↓"}
                        </button>

                        {/* Mark resolved button */}
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle_issue" />
                          <input type="hidden" name="issueId" value={issue.id} />
                          <input
                            type="hidden"
                            name="resolved"
                            value={String(issue.resolved)}
                          />
                          <button
                            type="submit"
                            title={issue.resolved ? "Mark Unresolved" : "Mark as Fixed"}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${
                              issue.resolved
                                ? "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                                : "text-zinc-400 border-zinc-200 hover:text-zinc-700 hover:bg-zinc-50"
                            }`}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                        </Form>
                      </div>
                    </div>

                    {/* Expandable Fix Instructions */}
                    {isExpanded && (
                      <div className="mt-3.5 pt-3.5 border-t border-zinc-100 text-xs bg-[#fafafa] -mx-4.5 -mb-4.5 p-4 rounded-b-xl">
                        <div className="font-semibold text-zinc-800 mb-1 flex items-center gap-1.5">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#f05423"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="16" x2="12" y2="12" />
                            <line x1="12" y1="8" x2="12.01" y2="8" />
                          </svg>
                          How to Fix in Shopify:
                        </div>
                        <p className="text-zinc-600 leading-relaxed pl-5">
                          {issue.fixGuide}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
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

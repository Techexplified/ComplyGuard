import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useLoaderData, Form, Link, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      scans: { orderBy: { createdAt: "desc" }, take: 10 },
      issues: { orderBy: [{ resolved: "asc" }, { severity: "asc" }, { createdAt: "desc" }] },
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
        scans: { orderBy: { createdAt: "desc" }, take: 10 },
        issues: { orderBy: [{ resolved: "asc" }, { severity: "asc" }, { createdAt: "desc" }] },
      },
    });
  }

  const url = new URL(request.url);
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

  if (intent === "reset_onboarding") {
    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: { onBoarding: false },
    });
    return redirect(`/app/onboarding${url.search}`);
  }

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

const ALL_18_CHECKS = [
  { ruleCode: "REFUND_POLICY_EXISTS", label: "Refund/return policy page exists", category: "POLICY", groupName: "Policy pages" },
  { ruleCode: "REFUND_POLICY_DISCLOSURE_INCOMPLETE", label: "Refund policy disclosure quality", category: "POLICY", groupName: "Policy pages" },
  { ruleCode: "SHIPPING_POLICY_EXISTS", label: "Shipping policy page exists", category: "POLICY", groupName: "Policy pages" },
  { ruleCode: "PRIVACY_POLICY_EXISTS", label: "Privacy policy page exists", category: "POLICY", groupName: "Policy pages" },
  { ruleCode: "TERMS_POLICY_EXISTS", label: "Terms of service page exists", category: "POLICY", groupName: "Policy pages" },
  { ruleCode: "POLICIES_NOT_IN_FOOTER", label: "Policies linked in storefront footer", category: "POLICY", groupName: "Policy pages" },

  { ruleCode: "PHONE_NUMBER_VISIBLE", label: "Phone number visible on storefront", category: "IDENTITY", groupName: "Contact & business" },
  { ruleCode: "EMAIL_OR_FORM_VISIBLE", label: "Email or contact form present", category: "IDENTITY", groupName: "Contact & business" },
  { ruleCode: "PHYSICAL_ADDRESS_VISIBLE", label: "Physical business address detected", category: "IDENTITY", groupName: "Contact & business" },
  { ruleCode: "BUSINESS_NAME_MISMATCH", label: "Business name matches Shopify settings", category: "IDENTITY", groupName: "Contact & business" },
  { ruleCode: "MERCHANT_CENTER_ADDRESS_VERIFY", label: "Address matches Merchant Center", category: "IDENTITY", groupName: "Contact & business" },

  { ruleCode: "MISSING_GTIN_BARCODE", label: "Products have GTIN / barcodes", category: "PRODUCT_FEED", groupName: "Product feed" },
  { ruleCode: "PRICE_MISMATCH_FEED", label: "Storefront prices match product feed", category: "PRODUCT_FEED", groupName: "Product feed" },
  { ruleCode: "MISSING_PRODUCT_IMAGES", label: "All active products have images", category: "PRODUCT_FEED", groupName: "Product feed" },
  { ruleCode: "RISKY_PROMOTIONAL_LANGUAGE", label: "No deceptive product claims", category: "AUP_RISK", groupName: "Product feed" },
  { ruleCode: "INVENTORY_AVAILABILITY_MISMATCH", label: "Inventory availability is accurate", category: "PRODUCT_FEED", groupName: "Product feed" },

  { ruleCode: "PAYMENT_METHODS_NOT_VISIBLE", label: "Payment methods displayed in footer", category: "TRUST_SIGNALS", groupName: "Checkout & trust" },
  { ruleCode: "SSL_SECURE_CHECKOUT", label: "Active SSL / secure checkout", category: "TRUST_SIGNALS", groupName: "Checkout & trust" },
];

function getShopifyDeepLink(ruleCode: string, shopDomain: string): string {
  const base = `https://${shopDomain}/admin`;
  if (ruleCode.startsWith("REFUND") || ruleCode.startsWith("SHIPPING") || ruleCode.startsWith("PRIVACY") || ruleCode.startsWith("TERMS")) {
    return `${base}/settings/policies`;
  }
  if (ruleCode === "POLICIES_NOT_IN_FOOTER") return `${base}/menus`;
  if (ruleCode.includes("ADDRESS") || ruleCode.includes("PHONE") || ruleCode.includes("BUSINESS_NAME") || ruleCode.includes("EMAIL")) {
    return `${base}/settings/general`;
  }
  if (ruleCode.includes("GTIN") || ruleCode.includes("PRICE") || ruleCode.includes("IMAGE") || ruleCode.includes("PROMOTIONAL") || ruleCode.includes("INVENTORY")) {
    return `${base}/products`;
  }
  if (ruleCode === "PAYMENT_METHODS_NOT_VISIBLE") return `${base}/themes/current/editor`;
  if (ruleCode === "SSL_SECURE_CHECKOUT") return `${base}/settings/domains`;
  return base;
}

function timeAgo(dateInput?: Date | string | null): string {
  if (!dateInput) return "never";
  const date = new Date(dateInput);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 90) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

  :root {
    --ink: #1c1a18;
    --ink-soft: #6b6560;
    --ink-faint: #a39c95;
    --canvas: #f1efe9;
    --surface: #ffffff;
    --line: #e6e1d9;
    --accent: #e2610c;
    --accent-hover: #c95209;
    --accent-soft: #faebe1;
    --accent-text: #a8430a;
    --disp: 'Space Grotesk', sans-serif;
    --body: 'Inter', sans-serif;
    --mono: 'JetBrains Mono', monospace;
  }
  * { box-sizing: border-box; }

  .cg-dash-wrap {
    min-height: 100vh;
    background: radial-gradient(circle at 15% 0%, #f7f5ef 0%, transparent 55%), var(--canvas);
    font-family: var(--body);
    color: var(--ink);
    display: flex;
    justify-content: center;
    padding: 32px 16px 80px;
  }

  .cg-dash-shell {
    width: 960px;
    min-width: 960px;
    max-width: 960px;
    background: var(--surface);
    border-radius: 20px;
    border: 1px solid var(--line);
    box-shadow: 0 20px 50px -20px rgba(28,26,24,.18);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .cg-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 32px;
    border-bottom: 1px solid var(--line);
  }
  .cg-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cg-brand-mark {
    width: 24px; height: 24px; border-radius: 6px;
    background: var(--accent);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-size: 11px; font-weight: 700; color: #fff;
  }
  .cg-brand-name {
    font-family: var(--disp); font-weight: 700; font-size: 16px; letter-spacing: -.01em; color: var(--ink);
  }
  .cg-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cg-nav-link {
    font-family: var(--disp);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink-soft);
    padding: 7px 16px;
    border-radius: 9px;
    text-decoration: none;
    cursor: pointer;
    background: transparent;
    border: none;
  }
  .cg-nav-link.active {
    color: var(--ink);
  }
  .cg-nav-pill {
    background: #f1efe9;
    color: var(--ink);
    font-family: var(--disp);
    font-size: 13.5px;
    font-weight: 600;
    padding: 7px 16px;
    border-radius: 9px;
    border: 1px solid #e6e1d9;
    cursor: pointer;
  }

  .cg-content {
    padding: 36px 36px 40px;
    display: flex;
    flex-direction: column;
    gap: 34px;
  }

  .cg-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
  }
  .cg-hero-left {
    display: flex;
    align-items: center;
    gap: 26px;
    flex: 1;
  }

  .cg-donut-wrap {
    position: relative;
    width: 104px; height: 104px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .cg-donut-svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
  }
  .cg-donut-center {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .cg-score-num {
    font-family: var(--disp);
    font-size: 32px;
    font-weight: 700;
    color: var(--ink);
    line-height: 1;
  }
  .cg-score-total {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-faint);
    margin-top: 3px;
  }

  .cg-hero-text {
    max-width: 440px;
  }
  .cg-eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 6px;
  }
  .cg-headline {
    font-family: var(--disp);
    font-size: 21px;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: -.02em;
    margin: 0 0 6px 0;
    line-height: 1.25;
  }
  .cg-subtext {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-soft);
    margin: 0;
  }

  .cg-hero-stats {
    display: flex;
    align-items: flex-end;
    gap: 28px;
    flex-shrink: 0;
  }
  .cg-stat-item {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .cg-stat-value {
    font-family: var(--disp);
    font-size: 22px;
    font-weight: 700;
    color: var(--ink);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .cg-stat-label {
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 600;
    color: var(--ink-faint);
    letter-spacing: .05em;
    text-transform: uppercase;
    margin-top: 6px;
  }

  .cg-section-header {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-faint);
    letter-spacing: .08em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }

  .cg-categories-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }
  .cg-cat-card {
    background: #ffffff;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cg-cat-title {
    font-family: var(--body);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .cg-cat-track {
    width: 100%;
    height: 4px;
    background: #e6e1d9;
    border-radius: 2px;
    overflow: hidden;
  }
  .cg-cat-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width .4s ease;
  }
  .cg-cat-sub {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .cg-issues-list {
    display: flex;
    flex-direction: column;
  }
  .cg-issue-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 4px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .cg-issue-badge {
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: .04em;
    padding: 3px 7px;
    border-radius: 5px;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .cg-badge-high {
    background: #fdf0eb;
    color: #e2610c;
  }
  .cg-badge-medium {
    background: #fdf6ec;
    color: #b45309;
  }
  .cg-badge-resolved {
    background: #ecfdf5;
    color: #059669;
  }
  .cg-issue-title {
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
  }
  .cg-issue-desc {
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    font-size: 12.5px;
  }
  .cg-issue-cat {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-faint);
    flex-shrink: 0;
    text-align: right;
    margin-right: 4px;
  }
  .cg-fix-btn {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-family: var(--body);
    font-size: 12px;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: 8px;
    text-decoration: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all .2s;
  }
  .cg-fix-btn:hover {
    background: #f5dfd3;
    color: #8c3608;
  }

  .cg-issue-expanded {
    background: #fbfaf7;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 18px;
    margin: 8px 0 12px;
    font-size: 12.5px;
    color: var(--ink);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cg-expanded-guide {
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .cg-passed-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 4px;
    cursor: pointer;
    background: transparent;
    border: none;
    font-family: var(--body);
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
  }
  .cg-passed-mark {
    width: 18px; height: 18px; border-radius: 50%;
    background: var(--ink);
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 10px;
    flex-shrink: 0;
  }
  .cg-passed-list {
    margin-top: 6px;
    padding: 12px 16px;
    background: #faf9f6;
    border-radius: 12px;
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cg-passed-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--ink-soft);
  }
  .cg-passed-icon {
    color: #10b981;
    font-weight: 700;
    font-size: 12px;
  }

  .cg-bottom-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 18px 36px 28px;
  }
  .cg-rescan-btn {
    background: var(--accent);
    color: #ffffff;
    font-family: var(--disp);
    font-size: 15px;
    font-weight: 700;
    padding: 13px 32px;
    border-radius: 14px;
    text-decoration: none;
    box-shadow: 0 8px 20px -4px rgba(226, 97, 12, 0.38);
    transition: all .2s;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .cg-rescan-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 10px 24px -4px rgba(226, 97, 12, 0.45);
  }
`;

export default function DashboardPage() {
  const { shop } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<"dashboard" | "history">("dashboard");
  const [showPassed, setShowPassed] = useState(false);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  const allIssues = shop.issues || [];
  const score = shop.complianceScore;

  const unresolvedIssues = allIssues.filter((i: any) => !i.resolved);
  const resolvedIssues = allIssues.filter((i: any) => i.resolved);

  const policyIssues = unresolvedIssues.filter((i: any) => i.category === "POLICY");
  const identityIssues = unresolvedIssues.filter((i: any) => i.category === "IDENTITY");
  const feedIssues = unresolvedIssues.filter((i: any) => i.category === "PRODUCT_FEED" || i.category === "AUP_RISK");
  const trustIssues = unresolvedIssues.filter((i: any) => i.category === "TRUST_SIGNALS");

  const policyPassed = Math.max(0, 6 - policyIssues.length);
  const identityPassed = Math.max(0, 5 - identityIssues.length);
  const feedPassed = Math.max(0, 5 - feedIssues.length);
  const trustPassed = Math.max(0, 2 - trustIssues.length);

  const totalPassed = policyPassed + identityPassed + feedPassed + trustPassed;
  const totalChecks = 18;
  const issuesFound = unresolvedIssues.length;

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const eyebrowText =
    score >= 85 ? "READY TO CONNECT" : score >= 60 ? "NEEDS ATTENTION" : "CRITICAL RISKS";
  const headlineText =
    score >= 85
      ? "Your store is compliant and ready"
      : "Your store isn't ready to connect yet";
  const descriptionText =
    score >= 85
      ? "All mandatory compliance policies and trust signals are active. Your store passes Google Merchant Center requirements."
      : "Fix the high-priority issues below before connecting to Google Merchant Center � they're the most common cause of suspensions.";

  const failedCodes = new Set(unresolvedIssues.map((i: any) => i.ruleCode));
  const passedChecksList = ALL_18_CHECKS.filter((c) => !failedCodes.has(c.ruleCode));

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="cg-dash-wrap">
        <div className="cg-dash-shell">

          {/* Top Bar */}
          <div className="cg-topbar">
            {/* <div className="cg-brand">
              <div className="cg-brand-mark">CG</div>
              <div className="cg-brand-name">ComplyGuard</div>
            </div> */}
            <div className="cg-nav">
              <button
                type="button"
                className={`cg-nav-link ${activeTab === "dashboard" ? "active" : ""}`}
                onClick={() => setActiveTab("dashboard")}
              >
                Dashboard
              </button>
              <button
                type="button"
                className="cg-nav-pill"
                onClick={() => setActiveTab(activeTab === "history" ? "dashboard" : "history")}
              >
                {activeTab === "history" ? "? Back to Dashboard" : "Scan History"}
              </button>
            </div>
          </div>

          {activeTab === "history" ? (
            <div className="cg-content">
              <div>
                <div className="cg-section-header">PAST COMPLIANCE AUDITS</div>
                <h2 className="cg-headline" style={{ fontSize: 18, marginBottom: 16 }}>
                  Scan History for {shop.shopDomain}
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(shop.scans || []).map((s: any) => (
                    <div
                      key={s.id}
                      style={{
                        padding: "14px 18px",
                        background: "#fff",
                        border: "1px solid #e6e1d9",
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Score: {s.score}/100</span>
                        <span style={{ color: "#a39c95", fontSize: 12, marginLeft: 12 }}>
                          {new Date(s.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#6b6560" }}>
                        {s.passedChecks}/{s.totalChecks} checks passed � {s.failedChecks} issues
                      </div>
                    </div>
                  ))}
                  {(shop.scans || []).length === 0 && (
                    <p style={{ color: "#a39c95", fontSize: 13 }}>No previous scans recorded yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="cg-content">
                {/* Hero / Score Section */}
                <div className="cg-hero">
                  <div className="cg-hero-left">
                    <div className="cg-donut-wrap">
                      <svg className="cg-donut-svg" width="104" height="104" viewBox="0 0 104 104">
                        <circle cx="52" cy="52" r={radius} fill="none" stroke="#e6e1d9" strokeWidth="8" />
                        <circle
                          cx="52"
                          cy="52"
                          r={radius}
                          fill="none"
                          stroke="#e2610c"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                          style={{ transition: "stroke-dashoffset 0.8s ease" }}
                        />
                      </svg>
                      <div className="cg-donut-center">
                        <span className="cg-score-num">{score}</span>
                        <span className="cg-score-total">/ 100</span>
                      </div>
                    </div>

                    <div className="cg-hero-text">
                      <div className="cg-eyebrow">{eyebrowText}</div>
                      <h1 className="cg-headline">{headlineText}</h1>
                      <p className="cg-subtext">{descriptionText}</p>
                    </div>
                  </div>

                  <div className="cg-hero-stats">
                    <div className="cg-stat-item">
                      <span className="cg-stat-value">{totalPassed}/{totalChecks}</span>
                      <span className="cg-stat-label">CHECKS PASSED</span>
                    </div>
                    <div className="cg-stat-item">
                      <span className="cg-stat-value">{issuesFound}</span>
                      <span className="cg-stat-label">ISSUES FOUND</span>
                    </div>
                    <div className="cg-stat-item">
                      <span className="cg-stat-value">{timeAgo(shop.lastScannedAt)}</span>
                      <span className="cg-stat-label">LAST SCANNED</span>
                    </div>
                  </div>
                </div>

                {/* BY CATEGORY */}
                <div>
                  <div className="cg-section-header">BY CATEGORY</div>
                  <div className="cg-categories-grid">
                    <div className="cg-cat-card">
                      <span className="cg-cat-title">Policy pages</span>
                      <div className="cg-cat-track">
                        <div className="cg-cat-fill" style={{ width: `${(policyPassed / 6) * 100}%` }} />
                      </div>
                      <span className="cg-cat-sub">{policyPassed} / 6 passed</span>
                    </div>

                    <div className="cg-cat-card">
                      <span className="cg-cat-title">Contact & business</span>
                      <div className="cg-cat-track">
                        <div className="cg-cat-fill" style={{ width: `${(identityPassed / 5) * 100}%` }} />
                      </div>
                      <span className="cg-cat-sub">{identityPassed} / 5 passed</span>
                    </div>

                    <div className="cg-cat-card">
                      <span className="cg-cat-title">Product feed data</span>
                      <div className="cg-cat-track">
                        <div className="cg-cat-fill" style={{ width: `${(feedPassed / 5) * 100}%` }} />
                      </div>
                      <span className="cg-cat-sub">{feedPassed} / 5 passed</span>
                    </div>

                    <div className="cg-cat-card">
                      <span className="cg-cat-title">Checkout & trust</span>
                      <div className="cg-cat-track">
                        <div className="cg-cat-fill" style={{ width: `${(trustPassed / 2) * 100}%` }} />
                      </div>
                      <span className="cg-cat-sub">{trustPassed} / 2 passed</span>
                    </div>
                  </div>
                </div>

                {/* ISSUES, RANKED BY PRIORITY */}
                <div>
                  <div className="cg-section-header">{issuesFound} ISSUES, RANKED BY PRIORITY</div>
                  <div className="cg-issues-list">
                    {unresolvedIssues.map((issue: any) => {
                      const deepLink = getShopifyDeepLink(issue.ruleCode, shop.shopDomain);
                      const isExpanded = expandedIssueId === issue.id;
                      const badgeCls = issue.severity === "CRITICAL" ? "cg-badge-high" : "cg-badge-medium";
                      const badgeLabel = issue.severity === "CRITICAL" ? "HIGH" : "MEDIUM";
                      const categoryDisplay =
                        issue.category === "POLICY"
                          ? "Policy pages"
                          : issue.category === "IDENTITY"
                          ? "Contact & business"
                          : issue.category === "TRUST_SIGNALS"
                          ? "Checkout & trust"
                          : "Product feed";

                      return (
                        <div key={issue.id}>
                          <div className="cg-issue-row">
                            <span className={`cg-issue-badge ${badgeCls}`}>{badgeLabel}</span>
                            <span
                              className="cg-issue-title"
                              onClick={() => setExpandedIssueId(isExpanded ? null : issue.id)}
                              style={{ cursor: "pointer" }}
                            >
                              {issue.title}
                            </span>
                            <span
                              className="cg-issue-desc"
                              onClick={() => setExpandedIssueId(isExpanded ? null : issue.id)}
                              style={{ cursor: "pointer" }}
                            >
                              {issue.description}
                            </span>
                            <span className="cg-issue-cat">{categoryDisplay}</span>
                            <a href={deepLink} target="_blank" rel="noopener noreferrer" className="cg-fix-btn">
                              Fix in Shopify ?
                            </a>
                          </div>

                          {isExpanded && (
                            <div className="cg-issue-expanded">
                              <div>
                                <strong>Problem: </strong>
                                <span className="cg-expanded-guide">{issue.description}</span>
                              </div>
                              <div>
                                <strong>How to resolve: </strong>
                                <span className="cg-expanded-guide">{issue.fixGuide}</span>
                              </div>
                              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                                <a
                                  href={deepLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="cg-fix-btn"
                                  style={{ background: "#e2610c", color: "#fff" }}
                                >
                                  Open Shopify Settings ?
                                </a>
                                <Form method="post">
                                  <input type="hidden" name="intent" value="toggle_issue" />
                                  <input type="hidden" name="issueId" value={issue.id} />
                                  <input type="hidden" name="resolved" value="false" />
                                  <button
                                    type="submit"
                                    className="cg-fix-btn"
                                    style={{ background: "#e6e1d9", color: "#1c1a18" }}
                                  >
                                    Mark as Resolved ?
                                  </button>
                                </Form>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {unresolvedIssues.length === 0 && (
                      <div style={{ padding: "24px 10px", textAlign: "center", color: "#10b981", fontWeight: 600, fontSize: 14 }}>
                        ?? All 18 checks passed! No compliance issues found.
                      </div>
                    )}

                    {resolvedIssues.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, color: "#a39c95", marginBottom: 6 }}>
                          {resolvedIssues.length} manually resolved issue(s):
                        </div>
                        {resolvedIssues.map((r: any) => (
                          <div key={r.id} className="cg-issue-row" style={{ opacity: 0.6 }}>
                            <span className="cg-issue-badge cg-badge-resolved">RESOLVED</span>
                            <span className="cg-issue-title" style={{ textDecoration: "line-through" }}>{r.title}</span>
                            <span className="cg-issue-desc">{r.description}</span>
                            <Form method="post">
                              <input type="hidden" name="intent" value="toggle_issue" />
                              <input type="hidden" name="issueId" value={r.id} />
                              <input type="hidden" name="resolved" value="true" />
                              <button
                                type="submit"
                                className="cg-fix-btn"
                                style={{ background: "transparent", border: "1px solid #e6e1d9", color: "#6b6560" }}
                              >
                                Undo
                              </button>
                            </Form>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Passed Checks Accordion */}
                    <button
                      type="button"
                      className="cg-passed-toggle"
                      onClick={() => setShowPassed(!showPassed)}
                    >
                      <div className="cg-passed-mark">?</div>
                      <span>
                        {totalPassed} checks passed � {showPassed ? "hide details" : "show details"}
                      </span>
                    </button>

                    {showPassed && (
                      <div className="cg-passed-list">
                        {passedChecksList.map((chk) => (
                          <div key={chk.ruleCode} className="cg-passed-row">
                            <span className="cg-passed-icon">?</span>
                            <span style={{ fontWeight: 500, color: "#1c1a18" }}>{chk.label}</span>
                            <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10.5, color: "#a39c95" }}>
                              {chk.groupName}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Re-Scan Button */}
              <div className="cg-bottom-bar">
                <Link to="/app/scanning" className="cg-rescan-btn">
                  Re - Scan Now
                </Link>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

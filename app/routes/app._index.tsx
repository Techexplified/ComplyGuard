import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useLoaderData, useLocation, Form, Link, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getMonthlyScanUsage } from "../service/scanner.server";

// --- Server Loader & Action --------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      scans: { orderBy: { createdAt: "desc" }, take: 20 },
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
        scans: { orderBy: { createdAt: "desc" }, take: 20 },
        issues: { orderBy: [{ resolved: "asc" }, { severity: "asc" }, { createdAt: "desc" }] },
      },
    });
  }

  const url = new URL(request.url);
  if (!shopRecord.onBoarding) {
    return redirect(`/app/onboarding${url.search}`);
  }

  const scanUsage = await getMonthlyScanUsage(shopDomain);
  return { shop: shopRecord, scanUsage };
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
    const newResolved = !currentResolved;

    await prisma.issue.update({
      where: { id: issueId },
      data: { resolved: newResolved },
    });

    // Real-time score recalculation based on remaining unresolved issues
    const remainingUnresolved = await prisma.issue.count({
      where: { shopId: session.shop, resolved: false },
    });
    const newPassed = Math.max(0, 18 - remainingUnresolved);
    const newScore = Math.round((newPassed / 18) * 100);

    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: { complianceScore: newScore },
    });

    return { ok: true, newScore };
  }

  return null;
};

// --- 18 Compliance Checks ----------------------------------------------------

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
  const cleanDomain = shopDomain.replace(".myshopify.com", "");
  const base = `https://admin.shopify.com/store/${cleanDomain}`;

  if (ruleCode.startsWith("REFUND") || ruleCode.startsWith("SHIPPING") || ruleCode.startsWith("PRIVACY") || ruleCode.startsWith("TERMS")) {
    return `${base}/settings/legal`;
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

function formatScanDates(dateInput: Date | string) {
  const d = new Date(dateInput);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateStr = `${monthNames[d.getMonth()]} ${d.getDate()}`;
  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  let primary = dateStr;
  let secondary = timeStr;

  if (isToday) {
    primary = "Today";
    secondary = `${dateStr}, ${timeStr}`;
  } else if (isYesterday) {
    primary = "Yesterday";
    secondary = timeStr;
  }

  return { primary, secondary, short: dateStr };
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

  :root {
    --ink: #1c1a18;
    --ink-soft: #6b6560;
    --ink-faint: #a39c95;
    --canvas: #f1f1f1;
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
    background: #f1f1f1;
    font-family: var(--body);
    color: var(--ink);
    display: flex;
    justify-content: center;
    padding: 32px 20px 80px;
    box-sizing: border-box;
  }

  .cg-dash-shell {
    width: 100%;
    max-width: 1080px;
    background: var(--surface);
    border-radius: 20px;
    border: 1px solid var(--line);
    box-shadow: 0 20px 50px -20px rgba(28,26,24,.18);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 900px) {
    .cg-dash-wrap { padding: 16px 12px 60px; }
    .cg-dash-shell { border-radius: 14px; }
    .cg-content { padding: 24px 20px 32px; gap: 24px; }
    .cg-hero { flex-direction: column; align-items: flex-start; gap: 20px; }
    .cg-hero-stats { align-self: flex-start; }
    .cg-categories-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 580px) {
    .cg-categories-grid { grid-template-columns: 1fr; }
    .cg-hero-left { flex-direction: column; align-items: flex-start; gap: 16px; }
    .cg-topbar { padding: 14px 20px; }
    .cg-hist-row { flex-wrap: wrap; gap: 12px; }
  }

  .cg-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 32px;
    border-bottom: 1px solid var(--line);
  }
  .cg-topbar-heading {
    font-family: var(--disp);
    font-size: 16px;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: -0.01em;
    margin: 0;
  }
  .cg-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
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
    transition: all .2s;
  }
  .cg-nav-link.active {
    color: var(--ink);
    font-weight: 700;
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
    transition: all .2s;
  }
  .cg-nav-pill.active {
    background: #e6e1d9;
    font-weight: 700;
  }
  .cg-nav-pill:hover {
    background: #e9e6dd;
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
  justify-content: center;
  align-items: center;
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
  .cg-issue-title { font-weight: 600; color: var(--ink); white-space: nowrap; background: none; border: none; padding: 0; font-family: inherit; font-size: inherit; cursor: pointer; text-align: left; }
  .cg-issue-desc { color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; font-size: 12.5px; background: none; border: none; padding: 0; font-family: inherit; cursor: pointer; text-align: left; }
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

  .cg-passed-accordion-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    margin-top: 12px;
    background: #fbfaf7;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink-soft);
    font-family: var(--body);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(28, 26, 24, 0.04);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    user-select: none;
    text-align: left;
  }
  .cg-passed-accordion-btn:hover {
    background: #f3f0e8;
    border-color: #d6cfc2;
    color: var(--ink);
    box-shadow: 0 2px 6px -1px rgba(28, 26, 24, 0.08);
  }
  .cg-passed-accordion-btn:active {
    transform: scale(0.99);
    background: #ece8dc;
  }
  .cg-passed-badge {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #ecfdf5;
    border: 1.5px solid #a7f3d0;
    color: #059669;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    flex-shrink: 0;
  }
  .cg-passed-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #047857;
    font-weight: 600;
    font-size: 12px;
    background: #ecfdf5;
    border: 1px solid #d1fae5;
    padding: 3px 9px;
    border-radius: 7px;
    margin-left: 6px;
    transition: all 0.15s ease;
  }
  .cg-passed-accordion-btn:hover .cg-passed-action {
    background: #d1fae5;
    border-color: #a7f3d0;
    color: #065f46;
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

  /* Scan History Styles */
  .cg-chart-card {
    background: #ffffff;
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 20px 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .cg-chart-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cg-chart-label {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .cg-chart-curr {
    font-family: var(--body);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .cg-chart-curr span {
    font-family: var(--disp);
    font-weight: 700;
    color: var(--accent);
  }

  .cg-hist-list {
    display: flex;
    flex-direction: column;
  }
  .cg-hist-row {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 16px 4px;
    border-bottom: 1px solid var(--line);
  }
  .cg-hist-date {
    width: 120px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cg-hist-primary {
    font-family: var(--body);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .cg-hist-secondary {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-faint);
  }
.cg-hist-badge {
  --score: 0deg;

  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--disp);
  font-size: 15px;
  font-weight: 700;
  flex-shrink: 0;

  /* Orange score ring */
  background: conic-gradient(
    #f97316 0deg,
    #f97316 var(--score),
    #e5e7eb var(--score),
    #e5e7eb 360deg
  );

  position: relative;
}

/* White center */
.cg-hist-badge::before {
  content: "";
  position: absolute;
  inset: 4px;
  background: white;
  border-radius: 50%;
}

/* Keep score above the ring */
.cg-hist-badge span {
  position: relative;
  z-index: 1;
}
  .cg-hist-badge.drop {
    border: 2px solid var(--accent);
    color: var(--accent);
  }
  .cg-hist-badge.improved {
    border: 2px solid #10b981;
    color: #10b981;
  }
  .cg-hist-badge.neutral {
    border: 2px solid #d1cec8;
    color: var(--ink);
  }

  .cg-hist-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .cg-hist-title {
    font-family: var(--body);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .cg-hist-sub {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cg-arr-down {
    color: var(--accent);
    font-weight: 600;
  }
  .cg-arr-up {
    color: #10b981;
    font-weight: 600;
  }

  .cg-pill-onboard {
    background: #f1efe9;
    color: var(--ink-soft);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .cg-view-btn {
    background: #ffffff;
    border: 1px solid #d1cec8;
    color: var(--ink);
    font-family: var(--body);
    font-size: 12.5px;
    font-weight: 500;
    padding: 6px 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: all .15s;
    flex-shrink: 0;
  }
  .cg-view-btn:hover {
    background: #f7f5ef;
    border-color: #b5b0a8;
  }

  .cg-bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
    padding: 20px 32px;
    background: #ffffff;
    border-top: 1px solid var(--line);
  }
  .cg-quota-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .cg-quota-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .cg-quota-count {
    font-family: var(--mono);
    font-weight: 600;
    color: var(--ink);
  }
  .cg-rescan-btn {
    background: var(--ink);
    color: #ffffff;
    font-family: var(--body);
    font-size: 13.5px;
    font-weight: 600;
    padding: 10px 22px;
    border-radius: 10px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }
  .cg-rescan-btn:hover {
    background: #332f2b;
    color: #ffffff;
  }
  .cg-rescan-btn-disabled {
    background: #e6e1d9 !important;
    color: #a39c95 !important;
    cursor: not-allowed !important;
  }
`;

export default function DashboardPage() {
  const { shop, scanUsage } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<"dashboard" | "history">("dashboard");
  const [showPassed, setShowPassed] = useState(false);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);

  const scans = shop.scans || [];
  const allIssues = shop.issues || [];
  const latestScan = scans[0];

  const unresolvedIssues = allIssues.filter((i) => !i.resolved);
  const resolvedIssues = allIssues.filter((i) => i.resolved);

  const totalChecks = 18;
  const issuesFound = unresolvedIssues.length;
  const totalPassed = Math.max(0, totalChecks - issuesFound);

  // Derive score directly from live state / latest scan
  const score = latestScan ? latestScan.score : Math.round((totalPassed / totalChecks) * 100);

  // Category counts based on real unresolved issues
  const policyIssues = unresolvedIssues.filter((i) => i.category === "POLICY").length;
  const identityIssues = unresolvedIssues.filter((i) => i.category === "IDENTITY").length;
  const feedIssues = unresolvedIssues.filter((i) => i.category === "PRODUCT_FEED" || i.category === "AUP_RISK").length;
  const trustIssues = unresolvedIssues.filter((i) => i.category === "TRUST_SIGNALS").length;

  const policyPassed = Math.max(0, 6 - policyIssues);
  const identityPassed = Math.max(0, 5 - identityIssues);
  const feedPassed = Math.max(0, 5 - feedIssues);
  const trustPassed = Math.max(0, 2 - trustIssues);

  // Circular gauge calculations
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  // Dynamic status messaging based on real score
  const eyebrowText =
    score >= 85 ? "READY TO CONNECT" : score >= 60 ? "NEEDS ATTENTION" : "CRITICAL RISKS";
  const headlineText =
    score >= 85
      ? "Your store is compliant and ready"
      : "Your store isn't ready to connect yet";
  const descriptionText =
    score >= 85
      ? "All mandatory compliance policies and trust signals are active. Your store passes shopify requirements."
      : "Fix the high-priority issues below before connecting to shopify for review .They're the most common cause of suspensions.";

  // Failed rule codes set for real passed checks breakdown
  const failedCodes = new Set(unresolvedIssues.map((i) => i.ruleCode));
  const passedChecksList = ALL_18_CHECKS.filter((c) => !failedCodes.has(c.ruleCode));

  // Chart data: up to 6 real scans, chronologically sorted (oldest -> newest)
  const chartScans = [...scans].slice(0, 6).reverse();

  // Dynamic SVG Y-scaling so differences are clearly visible
  const svgWidth = 860;
  const svgHeight = 90;
  const padX = 40;
  const padY = 20;

  const minScore = chartScans.length > 0 ? Math.max(0, Math.min(...chartScans.map((s) => s.score)) - 10) : 0;
  const maxScore = chartScans.length > 0 ? Math.min(100, Math.max(...chartScans.map((s) => s.score)) + 10) : 100;
  const scoreRange = Math.max(15, maxScore - minScore);

  const chartPoints = chartScans.map((s, idx) => {
    const total = chartScans.length;
    const x = total === 1 ? svgWidth / 2 : padX + (idx * (svgWidth - padX * 2)) / (total - 1);
    const y = svgHeight - padY - (((s.score || 0) - minScore) / scoreRange) * (svgHeight - padY * 2);
    const dateObj = formatScanDates(s.createdAt);
    const label = idx === total - 1 ? `${dateObj.short} (now)` : dateObj.short;
    return { x, y, score: s.score, label, id: s.id };
  });

  const pointsString = chartPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="cg-dash-wrap">
        <div className="cg-dash-shell">

          {/* Top Bar with left-aligned heading and right-aligned nav */}
          <div className="cg-topbar">
        {activeTab!="history"&&  <h1 className="cg-topbar-heading">Dashboard</h1> }   
            <div className="cg-nav">
              <button
                type="button"
                className={`cg-nav-pill justify-end ${activeTab === "history" ? "active" : ""}`}
                onClick={() => setActiveTab(activeTab === "history" ? "dashboard" : "history")}
              >
                {activeTab === "history" ? "← Back to Dashboard" : "Scan History"}
              </button>
            </div>
          </div>

          {/* -------------------- SCAN HISTORY VIEW -------------------- */}
          {activeTab === "history" ? (
            <div className="cg-content">
              <div>
                <div className="cg-eyebrow">SCAN HISTORY</div>
                <h1 className="cg-headline" style={{ fontSize: 24, margin: "2px 0 0" }}>
                  How your readiness has changed over time
                </h1>
              </div>

              {/* Trend Chart Card */}
              <div className="cg-chart-card">
                <div className="cg-chart-top">
                  <span className="cg-chart-label">
                    READINESS SCORE  LAST {chartScans.length || 1} SCANS
                  </span>
                  <span className="cg-chart-curr">
                    Currently <span>{score} / 100</span>
                  </span>
                </div>

                {chartScans.length > 0 ? (
                  <div style={{ width: "100%", overflowX: "auto" }}>
                    <svg viewBox={`0 0 ${svgWidth} 125`} style={{ width: "100%", height: "auto", minHeight: 110 }}>
                      <line x1={padX} y1={svgHeight} x2={svgWidth - padX} y2={svgHeight} stroke="#e6e1d9" strokeDasharray="3 3" />

                      {chartPoints.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="#e2610c"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={pointsString}
                        />
                      )}

                      {chartPoints.map((p, idx) => {
                        const isLatest = idx === chartPoints.length - 1;
                        return (
                          <g key={p.id}>
                            {isLatest ? (
                              <>
                                <circle cx={p.x} cy={p.y} r="6" fill="#1c1a18" />
                                <circle cx={p.x} cy={p.y} r="2.5" fill="#ffffff" />
                              </>
                            ) : (
                              <circle cx={p.x} cy={p.y} r="4.5" fill="#e2610c" />
                            )}
                            <text
                              x={p.x}
                              y={svgHeight + 24}
                              textAnchor="middle"
                              fontFamily="var(--mono)"
                              fontSize="11"
                              fill="#a39c95"
                            >
                              {p.label}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                ) : (
                  <div style={{ padding: "30px 0", textAlign: "center", color: "#a39c95", fontSize: 13 }}>
                    Run scans to build your compliance readiness trend line.
                  </div>
                )}
              </div>

              {/* All Scans List */}
              <div>
                <div className="cg-section-header">ALL SCANS</div>
                <div className="cg-hist-list">
                  {scans.map((scanItem, idx) => {
                    const olderScan = scans[idx + 1];
                    const isFirstScan = !olderScan;
                    const diff = olderScan ? scanItem.score - olderScan.score : 0;
                    const issuesDiff = olderScan ? scanItem.failedChecks - olderScan.failedChecks : 0;

                    let title = "No change since last scan";
                    let badgeClass = "neutral";
                    if (isFirstScan) {
                      title = "First scan";
                    } else if (diff > 0) {
                      title = `Score improved ${diff} point${diff > 1 ? "s" : ""}`;
                      badgeClass = "improved";
                    } else if (diff < 0) {
                      title = `Score dropped ${Math.abs(diff)} point${Math.abs(diff) > 1 ? "s" : ""} since last scan`;
                      badgeClass = "drop";
                    }

                    const dateInfo = formatScanDates(scanItem.createdAt);
                    const isExpanded = expandedScanId === scanItem.id;
                    const catScores = (scanItem.categoryScores as Record<string, number> | null) || {};

                    return (
                      <div key={scanItem.id}>
                        <div className="cg-hist-row">
                          <div className="cg-hist-date">
                            <span className="cg-hist-primary">{dateInfo.primary}</span>
                            <span className="cg-hist-secondary">{dateInfo.secondary}</span>
                          </div>

                          <div
                            className={`cg-hist-badge ${badgeClass}`}
                            style={{ "--score": `${scanItem.score * 3.6}deg` } as React.CSSProperties}
                          >
                            <span>{scanItem.score}</span>
                          </div>

                          <div className="cg-hist-info">
                            <span className="cg-hist-title">{title}</span>
                            <div className="cg-hist-sub">
                              {isFirstScan ? (
                                <span>Onboarding scan — {scanItem.passedChecks}/{scanItem.totalChecks} checks passed</span>
                              ) : diff < 0 ? (
                                <>
                                  <span className="cg-arr-down">↓ {Math.max(1, issuesDiff)} new issue{issuesDiff > 1 ? "s" : ""}</span>
                                  {olderScan && scanItem.passedChecks > olderScan.passedChecks && (
                                    <span className="cg-arr-up">↑ {scanItem.passedChecks - olderScan.passedChecks} issues resolved</span>
                                  )}
                                </>
                              ) : diff > 0 ? (
                                <span className="cg-arr-up">↑ {Math.abs(issuesDiff) || diff} issues resolved</span>
                              ) : (
                                <span>Routine scan — {scanItem.passedChecks}/{scanItem.totalChecks} checks passed</span>
                              )}
                            </div>
                          </div>

                          {isFirstScan && (
                            <span className="cg-pill-onboard">onboarding</span>
                          )}

                          <button
                            type="button"
                            className="cg-view-btn"
                            onClick={() => setExpandedScanId(isExpanded ? null : scanItem.id)}
                          >
                            {isExpanded ? "Close" : "View"}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="cg-issue-expanded" style={{ margin: "4px 0 14px 140px" }}>
                            <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                              Scan Breakdown ({new Date(scanItem.createdAt).toLocaleString()}):
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 4 }}>
                              <div>Policy: <strong>{catScores.policy ?? "�"}%</strong></div>
                              <div>Contact: <strong>{catScores.identity ?? "�"}%</strong></div>
                              <div>Feed: <strong>{catScores.feed ?? "�"}%</strong></div>
                              <div>Trust: <strong>{catScores.trust ?? "�"}%</strong></div>
                            </div>
                            <div style={{ marginTop: 4, color: "var(--ink-soft)" }}>
                              Passed: {scanItem.passedChecks} of {scanItem.totalChecks} checks  Issues: {scanItem.failedChecks}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {scans.length === 0 && (
                    <div style={{ padding: "30px 10px", textAlign: "center", color: "#a39c95", fontSize: 13 }}>
                      No scan history yet. Trigger your first scan to see results here!
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* -------------------- DASHBOARD MAIN VIEW -------------------- */
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
                      <span className="cg-stat-value align-middle">{issuesFound}</span>
                      <span className="cg-stat-label">ISSUES FOUND</span>
                    </div>
                    <div className="cg-stat-item">
                      <span className="cg-stat-value">{timeAgo(shop.lastScannedAt || latestScan?.createdAt)}</span>
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
                    {unresolvedIssues.map((issue) => {
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
                            <button type="button" className="cg-issue-title" onClick={() => setExpandedIssueId(isExpanded ? null : issue.id)}>{issue.title}</button>
                            <button type="button" className="cg-issue-desc" onClick={() => setExpandedIssueId(isExpanded ? null : issue.id)}>{issue.description}</button>
                            <span className="cg-issue-cat">{categoryDisplay}</span>
                            <a href={deepLink} target="_blank" rel="noopener noreferrer" className="cg-fix-btn">
                              Fix in Shopify →
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
                              {/* <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
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
                              </div> */}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {unresolvedIssues.length === 0 && (
                      <div style={{ padding: "24px 10px", textAlign: "center", color: "#10b981", fontWeight: 600, fontSize: 14 }}>
                        ✓ All 18 checks passed! No compliance issues found.
                      </div>
                    )}

                    {resolvedIssues.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, color: "#a39c95", marginBottom: 6 }}>
                          {resolvedIssues.length} manually resolved issue(s):
                        </div>
                        {resolvedIssues.map((r) => (
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

                    {/* Passed Checks Bar */}
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "6px 6px 6px 12px",
                        marginTop: "12px",
                        background: "#fbfaf7",
                        border: "1px solid var(--line)",
                        borderRadius: "10px",
                        color: "var(--ink-soft)",
                        fontFamily: "var(--body)",
                        fontSize: "13px",
                        fontWeight: 500,
                      }}
                    >
                      {/* <div className="cg-passed-badge">
                        ✓
                      </div> */}

                      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                        <strong style={{ color: "var(--ink)", fontWeight: 700 }}>
                          {totalPassed}
                        </strong>
                        <span>checks passed</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => setShowPassed(!showPassed)}
                        aria-expanded={showPassed}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          marginLeft: "6px",
                          padding: "5px 12px",
                          background: "var(--accent)",
                          color: "#ffffff",
                          fontSize: "12px",
                          fontWeight: 600,
                          fontFamily: "var(--body)",
                          border: "none",
                          borderRadius: "7px",
                          cursor: "pointer",
                          boxShadow: "0 1px 2px rgba(226, 97, 12, 0.25)",
                          transition: "background 0.2s ease, transform 0.1s ease",
                        }}
                        // onMouseEnter={(e) => {
                        //   e.currentTarget.style.background = "var(--accent-deep)";
                        // }}
                        // onMouseLeave={(e) => {
                        //   e.currentTarget.style.background = "var(--accent)";
                        // }}
                      >
                        <span>{showPassed ? "Hide details" : "Show details"}</span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            transform: showPassed ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </div>

                    {showPassed && (
                      <div className="cg-passed-list">
                        {passedChecksList.map((chk) => (
                          <div key={chk.ruleCode} className="cg-passed-row">
                            <span className="cg-passed-icon">✓</span>
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

              {/* Bottom Re-Scan Button with Monthly Quota */}
              <div className="cg-bottom-bar">
                <div className="cg-quota-info">
                  <span
                    className="cg-quota-dot"
                    style={{ background: scanUsage.canScan ? "#10b981" : "#ea580c" }}
                  />
                  <span>
                    Monthly Scans: <strong className="cg-quota-count">{scanUsage.count} / {scanUsage.limit} used</strong>
                    {scanUsage.canScan
                      ? ` (${scanUsage.remaining} remaining)`
                      : ` · Quota resets ${new Date(scanUsage.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                  </span>
                </div>
                {scanUsage.canScan ? (
                  <Link to={`/app/scanning${location.search}`} className="cg-rescan-btn">
                    Re - Scan Now
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="cg-rescan-btn cg-rescan-btn-disabled"
                    title={`Monthly scan limit reached (${scanUsage.limit}/${scanUsage.limit} scans used). Quota resets on ${new Date(scanUsage.resetsAt).toLocaleDateString()}.`}
                  >
                    Monthly Limit Reached (5/5)
                  </button>
                )}
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

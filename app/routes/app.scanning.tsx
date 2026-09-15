import { useState, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getMonthlyScanUsage,
  runStorefrontComplianceScan,
} from "../service/scanner.server";

// ─── Server ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain } });
  const scanUsage = await getMonthlyScanUsage(shopDomain);
  return { shop: shopDomain, shopRecord, scanUsage };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  try {
    const scanResult = await runStorefrontComplianceScan({ admin, shopDomain });
    return {
      success: true,
      score: scanResult.score,
      passedChecks: scanResult.passedChecks,
      totalChecks: scanResult.totalChecks,
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

// ─── Categories (4 groups covering all 18 checks) ────────────────────────────

const CATEGORIES = [
  {
    id: "policy",
    label: "Policy pages",
    statusText: "Checking refund policy page…",
    rules: [
      "REFUND_POLICY_EXISTS",
      "REFUND_POLICY_DISCLOSURE_INCOMPLETE",
      "SHIPPING_POLICY_EXISTS",
      "PRIVACY_POLICY_EXISTS",
      "TERMS_POLICY_EXISTS",
      "POLICIES_NOT_IN_FOOTER",
    ],
  },
  {
    id: "identity",
    label: "Contact & business info",
    statusText: "Checking contact information…",
    rules: [
      "PHONE_NUMBER_VISIBLE",
      "EMAIL_OR_FORM_VISIBLE",
      "PHYSICAL_ADDRESS_VISIBLE",
      "BUSINESS_NAME_MISMATCH",
      "MERCHANT_CENTER_ADDRESS_VERIFY",
    ],
  },
  {
    id: "feed",
    label: "Product feed data",
    statusText: "Checking product feed data…",
    rules: [
      "MISSING_GTIN_BARCODE",
      "PRICE_MISMATCH_FEED",
      "MISSING_PRODUCT_IMAGES",
      "RISKY_PROMOTIONAL_LANGUAGE",
      "INVENTORY_AVAILABILITY_MISMATCH",
    ],
  },
  {
    id: "trust",
    label: "Checkout & trust signals",
    statusText: "Checking checkout & trust signals…",
    rules: [
      "PAYMENT_METHODS_NOT_VISIBLE",
      "SSL_SECURE_CHECKOUT",
    ],
  },
] as const;

// ─── Styles ───────────────────────────────────────────────────────────────────

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  :root{
    --ink:#1c1a18;
    --ink-soft:#6b6560;
    --ink-faint:#a39c95;
    --canvas:#f1f1f1;
    --surface:#ffffff;
    --line:#e6e1d9;
    --accent:#e2610c;
    --accent-deep:#a8430a;
    --accent-soft:#fbe9db;
    --fail:#ef4444;
    --pass:#10b981;
    --disp:'Space Grotesk',sans-serif;
    --body:'Inter',sans-serif;
    --mono:'JetBrains Mono',monospace;
  }
  *{box-sizing:border-box;}

  .cg-canvas{
    margin:0;
    background:
      radial-gradient(circle at 15% 0%, #f7f5ef 0%, transparent 55%),
      var(--canvas);
    font-family:var(--body);
    color:var(--ink);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:28px 14px;
    min-height:100vh;
    overflow-x:auto;
  }

  .shell{
    width:920px;
    min-width:920px;
    max-width:920px;
    background:var(--surface);
    border-radius:20px;
    border:1px solid var(--line);
    box-shadow:0 20px 50px -20px rgba(28,26,24,.18);
    overflow:hidden;
    min-height:580px;
    display:flex;
    flex-direction:column;
  }

  .stage{
    flex:1;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    padding:44px 30px 48px;
  }

  /* ---- RINGS ---- */
  .rings{
    position:relative;
    width:220px;height:220px;
    display:flex;align-items:center;justify-content:center;
    margin-bottom:28px;
  }
  .ring{
    position:absolute;
    border-radius:50%;
    border:1.5px solid var(--accent);
    opacity:0;
    animation:pulse 2.4s cubic-bezier(.2,.6,.35,1) infinite;
  }
  .ring.r1{width:70px;height:70px;animation-delay:0s;}
  .ring.r2{width:70px;height:70px;animation-delay:.6s;}
  .ring.r3{width:70px;height:70px;animation-delay:1.2s;}
  .ring.r4{width:70px;height:70px;animation-delay:1.8s;}
  @keyframes pulse{
    0%{width:70px;height:70px;opacity:.55;border-width:1.5px;}
    100%{width:220px;height:220px;opacity:0;border-width:.5px;}
  }
  .rings.done .ring{
    animation:none;
    opacity:0;
  }

  .core{
    position:relative;
    z-index:2;
    width:70px;height:70px;
    border-radius:50%;
    background:var(--ink);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 8px 24px -6px rgba(28,26,24,.35);
  }
  .core-mark{
    font-family:var(--mono);
    font-size:15px;
    font-weight:600;
    color:var(--accent);
  }

  .pct{
    font-family:var(--disp);
    font-size:15px;
    font-weight:600;
    color:var(--ink-soft);
    margin-bottom:6px;
    font-variant-numeric:tabular-nums;
  }

  .status-line{
    font-size:16px;
    font-weight:600;
    color:var(--ink);
    margin-bottom:2px;
    min-height:24px;
    text-align:center;
  }
  .status-sub{
    font-family:var(--mono);
    font-size:11px;
    color:var(--ink-faint);
    letter-spacing:.04em;
    margin-bottom:34px;
  }

  /* ---- CHECKLIST (4 CATEGORIES) ---- */
  .checklist{
    width:100%;
    max-width:380px;
    display:flex;
    flex-direction:column;
    gap:0;
  }
  .check-row{
    display:flex;
    align-items:center;
    gap:12px;
    padding:11px 4px;
    border-bottom:1px solid var(--line);
    font-size:13.5px;
    font-weight:400;
    color:var(--ink-faint);
    transition:color .3s ease;
  }
  .check-row:last-child{border-bottom:none;}
  .check-row.done{
    color:var(--ink);
    font-weight:500;
  }
  .check-row.fail{
    color:var(--ink);
    font-weight:500;
  }
  .check-row.active{
    color:var(--ink);
    font-weight:600;
  }

  .mark{
    width:20px;height:20px;
    border-radius:50%;
    border:1.5px solid var(--line);
    flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;
    font-weight:700;
    color:transparent;
    transition:all .3s ease;
    position:relative;
  }
  .check-row.done .mark{
    background:var(--accent);
    border-color:var(--accent);
    color:#fff;
  }
  .check-row.fail .mark{
    background:var(--fail);
    border-color:var(--fail);
    color:#fff;
  }
  .check-row.active .mark{
    border-color:var(--accent);
    border-width:2px;
  }
  .check-row.active .mark::after{
    content:"";
    width:7px;height:7px;
    border-radius:50%;
    background:var(--accent);
    position:absolute;
  }

  .note{
    font-family:var(--mono);
    font-size:10.5px;
    color:var(--ink-faint);
    margin-top:26px;
    text-align:center;
  }

  /* ---- Countdown bar ---- */
  .countdown-track{
    width:100%;
    max-width:380px;
    height:2px;
    background:var(--line);
    border-radius:2px;
    overflow:hidden;
    margin-top:20px;
  }
  .countdown-fill{
    height:100%;
    background:var(--accent);
    border-radius:2px;
    transition:width 1s linear;
  }

  /* ---- Retry button ---- */
  .retry-btn{
    margin-top:16px;
    padding:8px 18px;
    font-family:var(--disp);
    font-size:13px;
    font-weight:600;
    color:#fff;
    background:var(--accent);
    border:none;
    border-radius:8px;
    cursor:pointer;
  }
  .retry-btn:hover{
    background:var(--accent-deep);
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScanningPage() {
  const { scanUsage } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();

  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  const hasTriggeredRef = useRef(false);
  const pctTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Auto-trigger scan on mount ONLY if quota allows
  useEffect(() => {
    if (!scanUsage.canScan) return;
    if (!hasTriggeredRef.current && fetcher.state === "idle" && !fetcher.data) {
      hasTriggeredRef.current = true;
      fetcher.submit({}, { method: "POST" });
    }
  }, [fetcher, scanUsage.canScan]);

  // 2. Advance percentage counter smoothly (holds at 92 until backend returns)
  useEffect(() => {
    if (!scanUsage.canScan) return;
    pctTimerRef.current = setInterval(() => {
      setPct((prev) => {
        const done = Boolean(fetcher.data?.success);
        if (!done && prev >= 92) return 92;
        if (prev >= 100) {
          if (pctTimerRef.current) clearInterval(pctTimerRef.current);
          return 100;
        }
        return Math.min(prev + (done ? 4 : 1.2), done ? 100 : 92);
      });
    }, 120);

    return () => {
      if (pctTimerRef.current) clearInterval(pctTimerRef.current);
    };
  }, [fetcher.data, scanUsage.canScan]);

  // 3. Derive active category step from pct (or completion)
  // Step 0: 0-24%   -> Policy pages active
  // Step 1: 25-49%  -> Policy pages done, Contact active
  // Step 2: 50-74%  -> Contact done, Product feed active
  // Step 3: 75-91%  -> Product feed done, Trust signals active
  // Step 4: 92%+    -> All done / finishing up
  useEffect(() => {
    if (pct >= 92) {
      setStep(4);
    } else if (pct >= 75) {
      setStep(3);
    } else if (pct >= 50) {
      setStep(2);
    } else if (pct >= 25) {
      setStep(1);
    } else {
      setStep(0);
    }
  }, [pct]);

  // 4. Handle scan response
  const isFinished = Boolean(fetcher.data?.success) && pct >= 100;
  const isError = Boolean(fetcher.data && !fetcher.data.success);

  useEffect(() => {
    if (fetcher.data?.success) {
      setStep(4);
    }
  }, [fetcher.data]);

  // 5. Auto-redirect countdown (3s after scan completes)
  useEffect(() => {
    if (!isFinished) return;
    setCountdown(3);
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(t);
          const rawSearch = location.search.replace(/^[?&]+/, "");
          const cleanUrl = rawSearch ? `/app?${rawSearch}` : "/app";
          navigate(cleanUrl, { replace: true });
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(t);
  }, [isFinished, navigate, location.search]);

  // Check results per category
  const issues = fetcher.data?.issues ?? [];
  const failedRuleCodes = new Set(issues.map((i: { ruleCode: string }) => i.ruleCode));

  const getRowState = (index: number): "pending" | "active" | "done" | "fail" => {
    if (isFinished) {
      const cat = CATEGORIES[index];
      const hasFailed = cat.rules.some((rule) => failedRuleCodes.has(rule));
      return hasFailed ? "fail" : "done";
    }

    if (index < step) return "done";
    if (index === step) return "active";
    return "pending";
  };

  // Status text
  let statusLineText = "Preparing scan…";
  if (isFinished) {
    statusLineText = `Scan complete — compliance score ${fetcher.data?.score ?? 0}/100`;
  } else if (isError) {
    statusLineText = "Scan failed";
  } else if (step < CATEGORIES.length) {
    statusLineText = CATEGORIES[step].statusText;
  } else {
    statusLineText = "Finishing up…";
  }

  // Sub status text
  let statusSubText = "Read-only · nothing changes on your store";
  if (isFinished) {
    statusSubText = `${fetcher.data?.passedChecks ?? 0} of 18 passed · ${issues.length} issues found`;
  } else if (isError) {
    statusSubText = fetcher.data?.error || "An unexpected error occurred.";
  }

  // ── Quota exceeded screen ────────────────────────────────────────────────────
  if (!scanUsage.canScan) {
    return (
      <>
        <style>{css}</style>
        <div className="cg-canvas">
          <div className="shell">
            <div className="stage">
              <div className="rings done">
                <div className="core">
                  <span className="core-mark">CG</span>
                </div>
              </div>
              <div className="status-line">Monthly scan limit reached</div>
              <div className="status-sub">
                You&apos;ve used all {scanUsage.limit} scans this month. Quota resets on{" "}
                {new Date(scanUsage.resetsAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                })}
                .
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{css}</style>
      <div className="cg-canvas">
        <div className="shell">
          <div className="stage">
            {/* Pulsing rings + core */}
            <div className={`rings${isFinished ? " done" : ""}`}>
              <div className="ring r1" />
              <div className="ring r2" />
              <div className="ring r3" />
              <div className="ring r4" />
              <div className="core">
                <span className="core-mark">
                  {isFinished ? "✓" : "CG"}
                </span>
              </div>
            </div>

            {/* Percentage */}
            <div className="pct">{Math.round(pct)}%</div>

            {/* Status line */}
            <div className="status-line">{statusLineText}</div>

            {/* Status sub */}
            <div className="status-sub">{statusSubText}</div>

            {/* 4 Checklist rows (matching provided image exactly) */}
            <div className="checklist">
              {CATEGORIES.map((cat, idx) => {
                const state = getRowState(idx);
                return (
                  <div key={cat.id} className={`check-row ${state}`}>
                    <div className="mark">
                      {state === "done" ? "✓" : state === "fail" ? "✗" : ""}
                    </div>
                    {cat.label}
                  </div>
                );
              })}
            </div>

            {/* Error retry */}
            {isError && (
              <button
                type="button"
                className="retry-btn"
                onClick={() => {
                  hasTriggeredRef.current = false;
                  setStep(0);
                  setPct(0);
                  fetcher.submit({}, { method: "POST" });
                }}
              >
                Retry scan
              </button>
            )}

            {/* Countdown redirect bar */}
            {isFinished && countdown !== null && (
              <div className="countdown-track">
                <div
                  className="countdown-fill"
                  style={{ width: `${((3 - countdown) / 3) * 100}%` }}
                />
              </div>
            )}

            {/* Footer note */}
            {!isFinished && (
              <div className="note">
                Scanning 18 checks · this usually takes under a minute
              </div>
            )}
          </div>
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

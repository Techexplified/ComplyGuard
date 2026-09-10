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
import { runStorefrontComplianceScan } from "../service/scanner.server";

// ─── Server ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain } });
  return { shop: shopDomain, shopRecord };
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

// ─── All 18 checks (mirrors scanner.server.ts exactly) ───────────────────────

const ALL_CHECKS = [
  { ruleCode: "REFUND_POLICY_EXISTS",               label: "Refund/return policy page exists" },
  { ruleCode: "REFUND_POLICY_DISCLOSURE_INCOMPLETE",label: "Refund policy disclosure quality" },
  { ruleCode: "SHIPPING_POLICY_EXISTS",              label: "Shipping policy page exists" },
  { ruleCode: "PRIVACY_POLICY_EXISTS",               label: "Privacy policy page exists" },
  { ruleCode: "TERMS_POLICY_EXISTS",                 label: "Terms of service page exists" },
  { ruleCode: "POLICIES_NOT_IN_FOOTER",              label: "Policies linked in storefront footer" },
  { ruleCode: "PHONE_NUMBER_VISIBLE",                label: "Phone number visible on storefront" },
  { ruleCode: "EMAIL_OR_FORM_VISIBLE",               label: "Email or contact form present" },
  { ruleCode: "PHYSICAL_ADDRESS_VISIBLE",            label: "Physical business address detected" },
  { ruleCode: "BUSINESS_NAME_MISMATCH",              label: "Business name matches Shopify settings" },
  { ruleCode: "MERCHANT_CENTER_ADDRESS_VERIFY",      label: "Address matches Merchant Center" },
  { ruleCode: "MISSING_GTIN_BARCODE",                label: "Products have GTIN / barcodes" },
  { ruleCode: "PRICE_MISMATCH_FEED",                 label: "Storefront prices match product feed" },
  { ruleCode: "MISSING_PRODUCT_IMAGES",              label: "All active products have images" },
  { ruleCode: "RISKY_PROMOTIONAL_LANGUAGE",          label: "No deceptive product claims" },
  { ruleCode: "INVENTORY_AVAILABILITY_MISMATCH",     label: "Inventory availability is accurate" },
  { ruleCode: "PAYMENT_METHODS_NOT_VISIBLE",         label: "Payment methods displayed in footer" },
  { ruleCode: "SSL_SECURE_CHECKOUT",                 label: "Active SSL / secure checkout" },
] as const;

// How far pct must advance for each check to be considered "done" (0-92%)
const CHECK_THRESHOLDS = ALL_CHECKS.map((_, i) =>
  Math.round(((i + 1) / ALL_CHECKS.length) * 92)
);

const ROW_HEIGHT = 46; // px — fixed row height for slide animation
const VISIBLE    = 4;  // rows shown at one time

// ─── Styles (exact match of the reference design) ────────────────────────────

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  :root{
    --ink:#1c1a18;
    --ink-soft:#6b6560;
    --ink-faint:#a39c95;
    --canvas:#f1efe9;
    --surface:#ffffff;
    --line:#e6e1d9;
    --accent:#e2610c;
    --accent-deep:#a8430a;
    --disp:'Space Grotesk',sans-serif;
    --body:'Inter',sans-serif;
    --mono:'JetBrains Mono',monospace;
  }
  *{box-sizing:border-box;}

  .cg-wrap{
    margin:0;
    background:
      radial-gradient(circle at 15% 0%,#f7f5ef 0%,transparent 55%),
      var(--canvas);
    font-family:var(--body);
    color:var(--ink);
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
    padding:28px 14px;
    overflow-x:auto;
  }

  .cg-shell{
    width:920px;min-width:920px;max-width:920px;
    background:var(--surface);
    border-radius:20px;
    border:1px solid var(--line);
    box-shadow:0 20px 50px -20px rgba(28,26,24,.18);
    overflow:hidden;
    min-height:580px;
    display:flex;flex-direction:column;
  }

  .cg-topbar{
    display:flex;align-items:center;gap:9px;
    padding:22px 30px;border-bottom:1px solid var(--line);
  }
  .cg-brand-mark{
    width:22px;height:22px;border-radius:6px;
    background:var(--accent);
    display:flex;align-items:center;justify-content:center;
    font-family:var(--mono);font-size:11px;font-weight:600;color:#fff;
  }
  .cg-brand-name{
    font-family:var(--disp);font-weight:600;font-size:14.5px;letter-spacing:-.01em;
  }

  .cg-stage{
    flex:1;display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    padding:40px 30px 46px;
  }

  /* ── Rings ── */
  .cg-rings{
    position:relative;width:220px;height:220px;
    display:flex;align-items:center;justify-content:center;
    margin-bottom:30px;
  }
  .cg-ring{
    position:absolute;border-radius:50%;
    border:1.5px solid var(--accent);opacity:0;
    animation:cgPulse 2.4s cubic-bezier(.2,.6,.35,1) infinite;
  }
  .cg-ring.r1{animation-delay:0s;}
  .cg-ring.r2{animation-delay:.6s;}
  .cg-ring.r3{animation-delay:1.2s;}
  .cg-ring.r4{animation-delay:1.8s;}
  @keyframes cgPulse{
    0%  {width:70px;height:70px;opacity:.55;border-width:1.5px;}
    100%{width:220px;height:220px;opacity:0;border-width:.5px;}
  }
  .cg-core{
    position:relative;z-index:2;
    width:70px;height:70px;border-radius:50%;
    background:var(--ink);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 8px 24px -6px rgba(28,26,24,.35);
    transition:background .4s ease;
  }
  .cg-core.done{background:var(--accent);}
  .cg-core-mark{
    font-family:var(--mono);font-size:15px;font-weight:600;color:var(--accent);
    transition:color .4s ease;
  }
  .cg-core.done .cg-core-mark{color:#fff;font-size:22px;}

  .cg-pct{
    font-family:var(--disp);font-size:15px;font-weight:600;
    color:var(--ink-soft);margin-bottom:6px;
    font-variant-numeric:tabular-nums;
  }
  .cg-status-line{
    font-size:16px;font-weight:500;color:var(--ink);
    margin-bottom:2px;min-height:24px;text-align:center;
  }
  .cg-status-sub{
    font-family:var(--mono);font-size:11px;color:var(--ink-faint);
    letter-spacing:.04em;margin-bottom:34px;
  }

  /* ── Sliding checklist ── */
  .cg-checklist-viewport{
    width:100%;max-width:380px;
    overflow:hidden;
    /* height set inline = VISIBLE * ROW_HEIGHT */
  }
  .cg-checklist-track{
    /* transform & transition set inline */
    will-change:transform;
  }
  .cg-check-row{
    display:flex;align-items:center;gap:11px;
    padding:0 4px;
    border-bottom:1px solid var(--line);
    font-size:13px;color:var(--ink-faint);
    transition:color .3s ease;
    /* height set inline */
  }
  .cg-check-row:last-child{border-bottom:none;}
  .cg-check-row.done   {color:var(--ink);}
  .cg-check-row.active {color:var(--ink);}
  .cg-check-row.passed {color:var(--ink);}
  .cg-check-row.failed {color:var(--ink);}

  .cg-mark{
    width:18px;height:18px;border-radius:50%;
    border:1.5px solid var(--line);
    flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
    font-size:10px;color:transparent;
    transition:all .3s ease;
  }
  .cg-check-row.done   .cg-mark{background:var(--accent);border-color:var(--accent);color:#fff;}
  .cg-check-row.passed .cg-mark{background:var(--accent);border-color:var(--accent);color:#fff;}
  .cg-check-row.failed .cg-mark{background:#ef4444;border-color:#ef4444;color:#fff;}
  .cg-check-row.active .cg-mark{border-color:var(--accent);border-width:2px;}
  .cg-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);}

  .cg-note{
    font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);
    margin-top:26px;text-align:center;
  }

  /* Error */
  .cg-error{
    background:#fff0f0;border:1px solid #fca5a5;border-radius:12px;
    padding:16px 20px;font-size:13px;color:#b91c1c;
    max-width:380px;width:100%;text-align:left;margin-bottom:20px;
  }
  .cg-retry-btn{
    margin-top:10px;background:#b91c1c;color:#fff;border:none;
    border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;
    cursor:pointer;transition:background .2s;
  }
  .cg-retry-btn:hover{background:#991b1b;}

  /* Countdown */
  .cg-countdown{
    width:100%;max-width:380px;height:2px;
    background:var(--line);border-radius:2px;overflow:hidden;margin-bottom:8px;
  }
  .cg-countdown-fill{height:100%;background:var(--accent);border-radius:2px;transition:width 1s linear;}
  .cg-countdown-label{
    font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);text-align:center;
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScanningPage() {
  const { shop } = useLoaderData<typeof loader>();
  const location  = useLocation();
  const navigate  = useNavigate();
  const fetcher   = useFetcher<typeof action>();

  const [pct, setPct]               = useState(0);
  const [renderStart, setRenderStart] = useState(0);   // first index currently rendered
  const [isSliding, setIsSliding]   = useState(false); // sliding animation in progress
  const [countdown, setCountdown]   = useState<number | null>(null);

  const hasTriggeredRef = useRef(false);
  const slidingRef      = useRef(false);
  const pctTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Auto-trigger scan on mount
  useEffect(() => {
    if (!hasTriggeredRef.current && fetcher.state === "idle" && !fetcher.data) {
      hasTriggeredRef.current = true;
      fetcher.submit({}, { method: "POST" });
    }
  }, [fetcher]);

  // 2. Advance pct counter (holds at 92 until backend returns)
  useEffect(() => {
    pctTimerRef.current = setInterval(() => {
      setPct((prev) => {
        const done = Boolean(fetcher.data?.success);
        if (!done && prev >= 92) return 92;
        if (prev >= 100) { clearInterval(pctTimerRef.current!); return 100; }
        return Math.min(prev + (done ? 4 : 1.2), done ? 100 : 92);
      });
    }, 120);
    return () => clearInterval(pctTimerRef.current!);
  }, [fetcher.data]);

  // Derive which check index is currently "active"
  const rawActiveIdx    = CHECK_THRESHOLDS.findIndex((t) => pct < t);
  const activeCheckIdx  = rawActiveIdx === -1 ? ALL_CHECKS.length : rawActiveIdx;

  // Target window start: 1 completed row above the active check, clamped to list bounds
  const targetWindowStart = Math.max(
    0,
    Math.min(activeCheckIdx - 1, ALL_CHECKS.length - VISIBLE)
  );

  // 3. Slide animation when window needs to advance
  useEffect(() => {
    if (targetWindowStart > renderStart && !slidingRef.current) {
      slidingRef.current = true;
      setIsSliding(true);
      const t = setTimeout(() => {
        setRenderStart((prev) => prev + 1);
        setIsSliding(false);
        slidingRef.current = false;
      }, 380);
      return () => clearTimeout(t);
    }
  }, [targetWindowStart, renderStart]);

  const isFinished = Boolean(fetcher.data?.success) && pct >= 100;
  const hasError   = fetcher.data && !fetcher.data.success;

  // 4. Auto-redirect countdown (3 s after scan finishes)
  useEffect(() => {
    if (!isFinished) return;
    setCountdown(3);
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(t);
          navigate(`/app${location.search}`);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isFinished, navigate, location.search]);

  // Build set of failed ruleCode from actual scan result
  const failedCodes = new Set(
    (fetcher.data?.issues ?? []).map((i: { ruleCode: string }) => i.ruleCode)
  );

  // Determine visual state of a check by its global index
  const getState = (idx: number): "pending" | "active" | "done" | "passed" | "failed" => {
    if (fetcher.data?.success) {
      return failedCodes.has(ALL_CHECKS[idx].ruleCode) ? "failed" : "passed";
    }
    if (idx < activeCheckIdx) return "done";
    if (idx === activeCheckIdx) return "active";
    return "pending";
  };

  // Items to render: VISIBLE + 1 during slide so bottom item slides in
  const itemsToRender = ALL_CHECKS.slice(
    renderStart,
    renderStart + VISIBLE + (isSliding ? 1 : 0)
  );

  // Status line text
  const statusText = isFinished
    ? `Scan complete — compliance score ${fetcher.data?.score ?? "—"}/100`
    : activeCheckIdx < ALL_CHECKS.length
    ? `Checking: ${ALL_CHECKS[activeCheckIdx].label}…`
    : "Saving results to database…";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="cg-wrap">
        <div className="cg-shell">

          {/* ── Topbar ── */}
          {/* <div className="cg-topbar">
            <div className="cg-brand-mark">CG</div>
            <div className="cg-brand-name">ComplyGuard</div>
          </div> */}

          {/* ── Stage ── */}
          <div className="cg-stage">

            {/* Rings */}
            <div className="cg-rings">
              {!isFinished && (
                <>
                  <div className="cg-ring r1" />
                  <div className="cg-ring r2" />
                  <div className="cg-ring r3" />
                  <div className="cg-ring r4" />
                </>
              )}
              <div className={`cg-core${isFinished ? " done" : ""}`}>
                <span className="cg-core-mark">{isFinished ? "✓" : "CG"}</span>
              </div>
            </div>

            {/* Percent */}
            <div className="cg-pct">{Math.round(pct)}%</div>

            {/* Status */}
            <div className="cg-status-line">{statusText}</div>
            <div className="cg-status-sub">
              {isFinished
                ? `${fetcher.data?.passedChecks ?? 0} of 18 passed · ${(fetcher.data?.issues ?? []).length} issues found`
                : "Read-only · nothing changes on your store"}
            </div>

            {/* Error */}
            {hasError && (
              <div className="cg-error">
                <strong>Scan error:</strong> {fetcher.data?.error}
                <br />
                <button
                  type="button"
                  className="cg-retry-btn"
                  onClick={() => {
                    hasTriggeredRef.current = false;
                    setPct(0);
                    setRenderStart(0);
                    fetcher.submit({}, { method: "POST" });
                  }}
                >
                  Retry scan
                </button>
              </div>
            )}

            {/* ── Sliding 4-row checklist ── */}
            <div
              className="cg-checklist-viewport"
              style={{ height: VISIBLE * ROW_HEIGHT }}
            >
              <div
                className="cg-checklist-track"
                style={{
                  transform: `translateY(${isSliding ? -ROW_HEIGHT : 0}px)`,
                  transition: isSliding
                    ? "transform 0.38s cubic-bezier(0.4,0,0.2,1)"
                    : "none",
                }}
              >
                {itemsToRender.map((check, localIdx) => {
                  const globalIdx = renderStart + localIdx;
                  const state = getState(globalIdx);
                  return (
                    <div
                      key={globalIdx}
                      className={`cg-check-row ${state}`}
                      style={{ height: ROW_HEIGHT }}
                    >
                      <div className="cg-mark">
                        {state === "active"  && <span className="cg-dot" />}
                        {(state === "done" || state === "passed") && "✓"}
                        {state === "failed"  && "✗"}
                      </div>
                      {check.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom note / countdown */}
            {isFinished && countdown !== null ? (
              <>
                <div className="cg-countdown">
                  <div
                    className="cg-countdown-fill"
                    style={{ width: `${((3 - countdown) / 3) * 100}%` }}
                  />
                </div>
                <div className="cg-countdown-label">
                  Redirecting to dashboard in {countdown}s…
                </div>
              </>
            ) : (
              <div className="cg-note">
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

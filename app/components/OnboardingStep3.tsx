interface OnboardingStep3Props {
  onBack?: () => void;
  onScan?: () => void;
  isScanning?: boolean;
  shopDomain?: string;
  isPasswordProtected?: boolean;
  isLocked?: boolean;
  hasEnvPassword?: boolean;
  isCheckingLock?: boolean;
  onRecheckLock?: () => void;
  errorMessage?: string | null;
}

const sweepAnimationCss = `
  .cg-scan-visual {
    position: relative;
    overflow: hidden;
  }
  .cg-scan-visual::after {
    content: "";
    position: absolute;
    top: 0;
    left: 100%;
    width: 40%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(30, 152, 115, 0.16), transparent);
    animation: sweepRTL 2.2s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes sweepRTL {
    0% {
      left: 100%;
    }
    100% {
      left: -40%;
    }
  }
`;

export function OnboardingStep3({
  onBack,
  onScan,
  isScanning = false,
  shopDomain = "",
  isPasswordProtected = false,
  isLocked = false,
  hasEnvPassword = false,
  isCheckingLock = false,
  onRecheckLock,
  errorMessage = null,
}: OnboardingStep3Props) {
  const cleanDomain = shopDomain.replace(".myshopify.com", "");
  const preferencesLink = {
    adminPath: "online_store/preferences",
    fullUrl: `https://admin.shopify.com/store/${cleanDomain}/online_store/preferences`,
    protocolUrl: "shopify://admin/online_store/preferences",
  };

  const handleShopifyNavigate = (
    e: React.MouseEvent<HTMLAnchorElement>,
    link: { protocolUrl: string; fullUrl: string }
  ) => {
    if (typeof window !== "undefined") {
      const isEmbedded = window.top !== window;
      if (isEmbedded) {
        e.preventDefault();
        try {
          window.open(link.protocolUrl, "_top");
          return;
        } catch {
          try {
            window.open(link.fullUrl, "_top");
            return;
          } catch {
            // fallback
          }
        }
      }
    }
  };

  return (
    <main className="p-6 sm:p-10 md:p-12 md:pb-9">
      <style dangerouslySetInnerHTML={{ __html: sweepAnimationCss }} />

      {/* Eyebrow */}
      <div className="text-xs font-bold tracking-[1.5px] text-[#c25e37] uppercase mb-2">
        SETUP · 2 OF 2
      </div>

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl md:text-[30px] font-bold text-zinc-900 tracking-tight leading-tight mb-2.5">
        Run your first scan
      </h1>

      {/* Description */}
      <div className="text-sm sm:text-[15px] text-zinc-600 leading-relaxed mb-6 max-w-175">
        <p>This checks your policies, contact info, and product data.</p>
        <p>Nothing changes on your store.</p>
      </div>

      {/* Server Error Alert Banner if any */}
      {errorMessage && (
        <div className="p-4 mb-6 bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm rounded-xl flex items-center gap-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-red-600"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Storefront Lock Status Banner */}
      {isLocked && hasEnvPassword ? (
        <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-2xl p-5 sm:p-6 mb-6 shadow-sm">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#dbeafe] border border-[#93c5fd] text-[#2563eb] flex items-center justify-center shrink-0">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[15px] font-bold text-[#1e40af]">
                    Storefront password configured in .env
                  </h3>
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#dbeafe] border border-[#93c5fd] text-[#1d4ed8]">
                    Ready to enter
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-[#1e3a8a] mt-0.5 leading-relaxed max-w-160">
                  Your storefront is password protected, but ComplyGuard will authenticate using the password in your environment. You can scan and enter the app without unlocking.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0">
              <button
                type="button"
                onClick={onRecheckLock}
                disabled={isCheckingLock}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-white border border-blue-200 text-blue-800 hover:bg-blue-50 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
                title="Refresh storefront check"
              >
                <svg
                  className={`w-3.5 h-3.5 ${
                    isCheckingLock ? "animate-spin text-blue-700" : "text-blue-500"
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                {isCheckingLock ? "Checking..." : "Re-check status"}
              </button>
            </div>
          </div>
        </div>
      ) : isPasswordProtected ? (
        <div className="bg-[#fff8f1] border border-[#fed7aa] rounded-2xl p-5 sm:p-6 mb-6 shadow-sm">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#ffedd5] border border-[#fdba74] text-[#ea580c] flex items-center justify-center shrink-0">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[15px] font-bold text-[#9a3412]">
                    Storefront is Password Protected
                  </h3>
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#ffedd5] border border-[#fdba74] text-[#c2410c]">
                    Action Required
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-[#7c2d12] mt-0.5 leading-relaxed max-w-160">
                  Your online store is locked behind a password. Public storefront access is required so ComplyGuard can verify policy pages, contact details, and ad compliance.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0">
              <button
                type="button"
                onClick={onRecheckLock}
                disabled={isCheckingLock}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
                title="Re-check if storefront password is removed"
              >
                <svg
                  className={`w-3.5 h-3.5 ${
                    isCheckingLock ? "animate-spin text-[#ea580c]" : "text-zinc-500"
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                {isCheckingLock ? "Checking..." : "Re-check status"}
              </button>
              <a
                href={preferencesLink.fullUrl}
                target="_top"
                rel="noopener noreferrer"
                onClick={(e) => handleShopifyNavigate(e, preferencesLink)}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#ea580c] hover:bg-[#c2410c] text-white shadow-xs transition active:scale-95 cursor-pointer text-center whitespace-nowrap"
              >
                Unlock in Shopify →
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-2xl p-4 sm:p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#dcfce7] border border-[#86efac] text-[#16a34a] flex items-center justify-center shrink-0">
                <svg
                  width="16"
                  height="16"
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
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-[#14532d]">
                    Storefront is unlocked and accessible
                  </h3>
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#dcfce7] border border-[#86efac] text-[#15803d]">
                    Ready
                  </span>
                </div>
                <p className="text-xs text-[#166534] mt-0.5">
                  Your storefront is live. ComplyGuard can verify your policies and merchant compliance.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRecheckLock}
              disabled={isCheckingLock}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-800 hover:bg-emerald-100/60 transition disabled:opacity-50 cursor-pointer"
              title="Refresh storefront check"
            >
              <svg
                className={`w-3 h-3 ${
                  isCheckingLock ? "animate-spin text-emerald-700" : "text-emerald-700"
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              {isCheckingLock ? "Checking..." : "Refresh"}
            </button>
          </div>
        </div>
      )}

      {/* Center Showcase Container */}
      <div className="bg-[#fafafa] border border-zinc-200/90 rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center mb-6">
        {/* Floating Checklist Card */}
        <div className="cg-scan-visual bg-white border border-zinc-200/80 rounded-2xl p-5 sm:px-7 sm:py-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] w-full max-w-85 space-y-3.5">
          {/* Check Item 1 */}
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full bg-[#faeae3] text-[#c25e37] flex items-center justify-center shrink-0">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c25e37"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-sm font-medium text-zinc-700">
              Refund policy page
            </span>
          </div>

          {/* Check Item 2 */}
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full bg-[#faeae3] text-[#c25e37] flex items-center justify-center shrink-0">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c25e37"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-sm font-medium text-zinc-700">
              Contact information
            </span>
          </div>

          {/* Check Item 3 */}
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full bg-[#faeae3] text-[#c25e37] flex items-center justify-center shrink-0">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c25e37"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-sm font-medium text-zinc-700">
              Product feed data
            </span>
          </div>
        </div>

        {/* Ready when you are */}
        <h3 className="text-base sm:text-lg font-bold text-zinc-900 mt-6 mb-1 text-center tracking-tight">
          Ready when you are
        </h3>
        <p className="text-xs sm:text-[13.5px] text-zinc-500 text-center font-normal">
          18 checks · read-only · about 40 seconds
        </p>
      </div>

      {/* Primary Action Button */}
      {isPasswordProtected ? (
        <div className="space-y-3">
          <button
            type="button"
            disabled={true}
            className="w-full bg-zinc-200 text-zinc-400 font-semibold text-base sm:text-[16.5px] py-4 rounded-xl sm:rounded-2xl cursor-not-allowed shadow-none flex items-center justify-center gap-2 border border-zinc-300/80"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Storefront is locked — Unlock to scan
          </button>
          <p className="text-xs sm:text-[13px] text-[#c25e37] font-medium text-center">
            ⚠️ Please remove password protection in Shopify to enable scanning and access the app.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            disabled={isScanning || isCheckingLock}
            onClick={onScan}
            className="w-full bg-[#f05423] hover:bg-[#d94819] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base sm:text-[16.5px] py-4 rounded-xl sm:rounded-2xl transition shadow-sm text-center block cursor-pointer"
          >
            {isScanning ? "Scanning store..." : "Scan my store"}
          </button>
          <p className="text-xs sm:text-[13px] text-zinc-400 font-mono tracking-tight text-center">
            {isLocked && hasEnvPassword
              ? "Storefront access enabled via .env password"
              : "You can re-run this scan anytime from your dashboard"}
          </p>
        </div>
      )}

      {/* Divider Line */}
      <hr className="border-t border-[#f0f0f2] my-5" />

      {/* Bottom Action Bar */}
      <div className="flex items-center justify-start">
        <button
          type="button"
          onClick={onBack}
          className="text-zinc-600 hover:text-zinc-900 font-semibold text-[14.5px] px-2 py-2 transition cursor-pointer"
        >
          Back
        </button>
      </div>
    </main>
  );
}

export default OnboardingStep3;


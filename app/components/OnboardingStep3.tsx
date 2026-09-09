interface OnboardingStep3Props {
  onBack?: () => void;
  onScan?: () => void;
  isScanning?: boolean;
}

export function OnboardingStep3({
  onBack,
  onScan,
  isScanning = false,
}: OnboardingStep3Props) {
  return (
    <main className="p-6 sm:p-10 md:p-12 md:pb-9">
      {/* Eyebrow */}
      <div className="text-xs font-bold tracking-[1.5px] text-[#c25e37] uppercase mb-2">
        SETUP · 2 OF 2
      </div>

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl md:text-[30px] font-bold text-zinc-900 tracking-tight leading-tight mb-2.5">
        Run your first scan
      </h1>

      {/* Description */}
      <div className="text-sm sm:text-[15px] text-zinc-600 leading-relaxed mb-8 max-w-175">
        <p>This checks your policies, contact info, and product data.</p>
        <p>Nothing changes on your store.</p>
      </div>

      {/* Center Showcase Container */}
      <div className="bg-[#fafafa] border border-zinc-200/90 rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center mb-6">
        {/* Floating Checklist Card */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 sm:px-7 sm:py-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] w-full max-w-85 space-y-3.5">
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

      {/* Big Orange Primary Button */}
      <button
        type="button"
        disabled={isScanning}
        onClick={onScan}
        className="w-full bg-[#f05423] hover:bg-[#d94819] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base sm:text-[16.5px] py-4 rounded-xl sm:rounded-2xl transition shadow-sm text-center block cursor-pointer"
      >
        {isScanning ? "Scanning store..." : "Scan my store"}
      </button>

      {/* Sub-caption below the button */}
      <p className="text-xs sm:text-[13px] text-zinc-400 font-mono tracking-tight text-center mt-3.5 mb-6">
        You can re-run this scan anytime from your dashboard
      </p>

      {/* Divider Line */}
      <hr className="border-t border-[#f0f0f2] mb-5" />

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


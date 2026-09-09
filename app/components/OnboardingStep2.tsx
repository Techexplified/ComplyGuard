import { useState } from "react";

interface OnboardingStep2Props {
  onBack?: () => void;
  onContinue?: () => void;
  shopDomain?: string;
  initialEmbedEnabled?: boolean;
}

export function OnboardingStep2({
  onBack,
  onContinue,
  initialEmbedEnabled = true,
}: OnboardingStep2Props) {
  const [embedEnabled, setEmbedEnabled] = useState(initialEmbedEnabled);

  return (
    <main className="p-6 sm:p-10 md:p-12 md:pb-9">
      {/* Eyebrow */}
      <div className="text-xs font-bold tracking-[1.5px] text-[#c25e37] uppercase mb-2">
        SETUP · 1 OF 2
      </div>

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl md:text-[30px] font-bold text-zinc-900 tracking-tight leading-tight mb-3">
        Turn on the storefront embed
      </h1>

      {/* Description */}
      <p className="text-sm sm:text-[15px] text-zinc-600 leading-relaxed mb-8 max-w-175">
        A webhook tells us when something changes &mdash; but not whether
        it&apos;s actually visible to shoppers. The embed lets us check that
        too.
      </p>

      {/* Comparison Preview Container */}
      <div className="bg-[#fafafa] border border-zinc-200/90 rounded-2xl p-6 sm:p-8 mb-6">
        <div className="flex flex-col md:flex-row items-center gap-4 sm:gap-6">
          {/* Left Box: WITHOUT EMBED */}
          <div className="w-full md:flex-1 bg-white border border-zinc-200 rounded-xl p-5 sm:p-6 shadow-sm">
            <div className="text-[11px] font-mono font-medium tracking-wider text-zinc-400 uppercase mb-4">
              WITHOUT EMBED
            </div>

            {/* Skeleton placeholders */}
            <div className="space-y-2.5 mb-6">
              <div className="h-2.5 bg-zinc-200/80 rounded-full w-full" />
              <div className="h-2.5 bg-zinc-200/80 rounded-full w-3/5" />
            </div>

            <div className="border-t border-zinc-100 pt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono text-zinc-500 bg-zinc-100">
                policy: unknown
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono text-zinc-500 bg-zinc-100">
                payment icons: unknown
              </span>
            </div>
          </div>

          {/* Arrow */}
          <div
            className="text-zinc-400 flex items-center justify-center shrink-0 py-1 md:py-0"
            aria-hidden="true"
          >
            <svg
              className="rotate-90 md:rotate-0"
              width="20"
              height="20"
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

          {/* Right Box: WITH EMBED */}
          <div className="w-full md:flex-1 bg-white border border-zinc-200 rounded-xl p-5 sm:p-6 shadow-sm">
            <div className="text-[11px] font-mono font-medium tracking-wider text-zinc-400 uppercase mb-4">
              WITH EMBED
            </div>

            {/* Skeleton placeholders */}
            <div className="space-y-2.5 mb-6">
              <div className="h-2.5 bg-zinc-200/80 rounded-full w-full" />
              <div className="h-2.5 bg-zinc-200/80 rounded-full w-3/5" />
            </div>

            <div className="border-t border-zinc-100 pt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium text-[#c25e37] bg-[#faeae3]">
                policy: visible ✓
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium text-[#c25e37] bg-[#faeae3]">
                payment icons: visible ✓
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Embed Toggle Card */}
      <div className="bg-white border border-zinc-200 rounded-xl p-5 sm:p-6 flex items-center justify-between shadow-sm mb-10">
        <div>
          <h3 className="text-[15px] sm:text-base font-bold text-zinc-900 tracking-tight">
            ComplyGuard theme embed
          </h3>
          <p className="text-xs sm:text-[13.5px] text-zinc-500 mt-0.5">
            Read-only ; checks visibility, changes nothing on your storefront
          </p>
        </div>

        {/* Toggle Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={embedEnabled}
          onClick={() => setEmbedEnabled(!embedEnabled)}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f05423] focus-visible:ring-offset-2 ${
            embedEnabled ? "bg-[#f05423]" : "bg-zinc-300"
          }`}
        >
          <span className="sr-only">Enable ComplyGuard theme embed</span>
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out mt-1 ${
              embedEnabled ? "translate-x-6 ml-0" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Divider Line */}
      <hr className="border-t border-[#f0f0f2] mb-6" />

      {/* Bottom Action Bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-zinc-600 hover:text-zinc-900 font-semibold text-[14.5px] px-2 py-2 transition cursor-pointer"
        >
          Back
        </button>

        <button
          type="button"
          disabled={!embedEnabled}
          onClick={onContinue}
          className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900 active:scale-[0.98] disabled:active:scale-100 text-white text-[14.5px] font-semibold px-8 py-3 rounded-xl transition shadow-sm cursor-pointer"
        >
          Continue
        </button>
      </div>
    </main>
  );
}

export default OnboardingStep2;

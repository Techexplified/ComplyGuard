import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, Form, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
   
  // Retrieve or initialize the shop record in database
  let shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shopRecord) {
    shopRecord = await prisma.shop.create({
      data: {
        id: session.shop,
        shopDomain: session.shop,
        accessToken: session.accessToken || "",
        onBoarding: false,
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

export const action = async ({ request }: LoaderFunctionArgs) => {
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

  return null;
};

export default function MainPage() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-zinc-900 p-6 md:p-10 font-sans antialiased">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-[#f05423] text-white font-extrabold text-sm tracking-tight w-9 h-9 rounded-lg flex items-center justify-center">
              CG
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900">
                ComplyGuard Dashboard
              </h1>
              <p className="text-sm text-zinc-500">
                Connected store: <span className="font-medium text-zinc-700">{shop.shopDomain}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Onboarding Completed
            </span>

            {/* Reset Onboarding button for quick testing */}
            <Form method="post">
              <input type="hidden" name="intent" value="reset_onboarding" />
              <button
                type="submit"
                className="text-xs text-zinc-500 hover:text-zinc-800 underline cursor-pointer"
              >
                Reset Onboarding (Test)
              </button>
            </Form>
          </div>
        </div>

        {/* Status / Quick Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Compliance Health Score
            </div>
            <div className="text-3xl font-extrabold text-zinc-900">
              {shop.complianceScore}/100
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Store is protected and monitored.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Automated Protection
            </div>
            <div className="text-lg font-bold text-emerald-600 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Active
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Scanning 18 known policy triggers.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Last Scanned
            </div>
            <div className="text-sm font-semibold text-zinc-800">
              {shop.lastScannedAt
                ? new Date(shop.lastScannedAt).toLocaleString()
                : "Awaiting first full scan"}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Continuous background monitoring.
            </p>
          </div>
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

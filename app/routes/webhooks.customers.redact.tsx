import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[GDPR Compliance] Received ${topic} for ${shop}:`, payload);

  // ComplyGuard does not collect, store, or process end-customer personal data.
  return new Response(JSON.stringify({ message: "No customer data to redact." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};


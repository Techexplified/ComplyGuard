import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[GDPR Compliance] Received ${topic} for ${shop}:`, payload);

  const topicUpper = topic.toUpperCase();
  if (topicUpper.includes("SHOP") && topicUpper.includes("REDACT")) {
    try {
      const existingShop = await db.shop.findUnique({ where: { shopDomain: shop } });
      if (existingShop) {
        await db.shop.delete({ where: { shopDomain: shop } });
      }
      await db.session.deleteMany({ where: { shop } });
    } catch (error) {
      console.error(`[GDPR Compliance] Error purging shop ${shop}:`, error);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};


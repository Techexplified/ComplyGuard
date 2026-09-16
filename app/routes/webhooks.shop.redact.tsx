import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[GDPR Compliance] Received ${topic} for ${shop}:`, payload);

  // 48 hours after uninstall, delete all stored data for this shop
  try {
    const existingShop = await db.shop.findUnique({ where: { shopDomain: shop } });
    if (existingShop) {
      await db.shop.delete({ where: { shopDomain: shop } });
    }
    await db.session.deleteMany({ where: { shop } });
  } catch (error) {
    console.error(`[GDPR Compliance] Error purging data for shop ${shop}:`, error);
  }

  return new Response(JSON.stringify({ message: "Shop data deleted successfully." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};


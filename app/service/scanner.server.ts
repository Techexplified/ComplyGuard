import * as cheerio from "cheerio";
import prisma from "../db.server";

interface ScanContext {
  admin: {
    graphql: (
      query: string,
      options?: Record<string, unknown>
    ) => Promise<Response>;
  };
  shopDomain: string;
}

export interface IssueResult {
  category: "POLICY" | "IDENTITY" | "PRODUCT_FEED" | "TRUST_SIGNALS" | "AUP_RISK";
  severity: "CRITICAL" | "WARNING" | "INFO";
  ruleCode: string;
  title: string;
  description: string;
  fixGuide: string;
}

export async function runStorefrontComplianceScan({
  admin,
  shopDomain,
}: ScanContext) {
  const issues: IssueResult[] = [];
  let passedChecks = 0;
  const totalChecks = 18;

  // -------------------------------------------------------------
  // 1. Fetch Shop & Product Data from Shopify Admin GraphQL API
  // -------------------------------------------------------------
  const adminResponse = await admin.graphql(`
    #graphql
    query GetShopComplianceData {
      shop {
        name
        email
        contactEmail
        myshopifyDomain
        primaryDomain {
          url
          host
          sslEnabled
        }
        billingAddress {
          address1
          city
          country
          zip
        }
      }
      products(first: 20) {
        nodes {
          id
          title
          descriptionHtml
          featuredImage {
            url
          }
          variants(first: 5) {
            nodes {
              id
              barcode
              sku
              price
              availableForSale
            }
          }
        }
      }
    }
  `);

  const { data } = await adminResponse.json();
  const shopData = data?.shop;
  const products = data?.products?.nodes || [];
  const storeUrl = shopData?.primaryDomain?.url || `https://${shopDomain}`;

interface StorefrontProduct {
  id: number | string;
  title: string;
  variants: Array<{
    id: number | string;
    price: string;
    available?: boolean;
  }>;
}

  // -------------------------------------------------------------
  // 2. Fetch Storefront Homepage & Public Data (Parallel)
  // -------------------------------------------------------------
  async function getStorefrontAuthHeaders(targetUrl: string): Promise<Record<string, string>> {
    const storePassword = process.env.STOREFRONT_PASSWORD?.trim();
    const baseHeaders: Record<string, string> = {
      "User-Agent": "ComplyGuard-Compliance-Auditor/1.0",
    };

    if (!storePassword) {
      return baseHeaders;
    }

    try {
      console.log(
        `[Storefront Auth] STOREFRONT_PASSWORD detected in .env. Authenticating against ${targetUrl}/password...`
      );

      // 1. Fetch password page to retrieve CSRF token and initial cookies
      const passPageRes = await fetch(`${targetUrl}/password`, {
        headers: baseHeaders,
      });

      const initCookies =
        typeof passPageRes.headers.getSetCookie === "function"
          ? passPageRes.headers.getSetCookie()
          : [passPageRes.headers.get("set-cookie") || ""];

      const cookieMap = new Map<string, string>();
      for (const c of initCookies) {
        if (!c) continue;
        const [nameVal] = c.split(";");
        const [name, val] = nameVal.split("=");
        if (name && val) cookieMap.set(name.trim(), val.trim());
      }

      const passHtml = await passPageRes.text();
      const $pass = cheerio.load(passHtml);
      const authToken = $pass('input[name="authenticity_token"]').val() || "";

      const formData = new URLSearchParams();
      if (authToken) {
        formData.append("authenticity_token", String(authToken));
      }
      formData.append("password", storePassword);

      const initCookieHeader = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      // 2. Submit password to unlock storefront session
      const postRes = await fetch(`${targetUrl}/password`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(initCookieHeader ? { Cookie: initCookieHeader } : {}),
        },
        body: formData.toString(),
        redirect: "manual",
      });

      const postCookies =
        typeof postRes.headers.getSetCookie === "function"
          ? postRes.headers.getSetCookie()
          : [postRes.headers.get("set-cookie") || ""];

      for (const c of postCookies) {
        if (!c) continue;
        const [nameVal] = c.split(";");
        const [name, val] = nameVal.split("=");
        if (name && val) cookieMap.set(name.trim(), val.trim());
      }

      const finalCookieHeader = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      if (finalCookieHeader) {
        console.log(
          `[Storefront Auth] Successfully acquired storefront session cookie. Unlocking password-protected store for audit.`
        );
        return {
          ...baseHeaders,
          Cookie: finalCookieHeader,
        };
      }
    } catch (err) {
      console.warn(
        "[Storefront Auth] Failed to authenticate with STOREFRONT_PASSWORD:",
        err
      );
    }

    return baseHeaders;
  }

  const storefrontHeaders = await getStorefrontAuthHeaders(storeUrl);

  let homepageHtml = "";
  let storefrontProductsJson: StorefrontProduct[] = [];
  let contactPageHtml = "";

  const [homeRes, prodJsonRes, contactRes] = await Promise.allSettled([
    fetch(storeUrl, {
      headers: storefrontHeaders,
    }),
    fetch(`${storeUrl}/products.json?limit=20`, {
      headers: storefrontHeaders,
    }),
    fetch(`${storeUrl}/pages/contact`, {
      headers: storefrontHeaders,
    }),
  ]);

  if (homeRes.status === "fulfilled" && homeRes.value.ok) {
    try {
      homepageHtml = await homeRes.value.text();
      console.log(
        `\n============================================================\n` +
        `[FETCHED HOMEPAGE HTML] URL: ${storeUrl} (${homepageHtml.length} characters)\n` +
        `============================================================`
      );
      console.log(homepageHtml);
      console.log(`==================== [END HOMEPAGE HTML] ====================\n`);
    } catch (e) {
      console.error("Failed to read homepage HTML text:", e);
    }
  } else {
    console.warn(`[Storefront Fetch] Homepage fetch failed or rejected for ${storeUrl}`);
  }

  if (prodJsonRes.status === "fulfilled" && prodJsonRes.value.ok) {
    try {
      const json = await prodJsonRes.value.json();
      storefrontProductsJson = json?.products || [];
    } catch {
      // Ignore JSON parse error
    }
  }

  if (contactRes.status === "fulfilled" && contactRes.value.ok) {
    try {
      contactPageHtml = await contactRes.value.text();
      console.log(
        `\n============================================================\n` +
        `[FETCHED CONTACT PAGE HTML] URL: ${storeUrl}/pages/contact (${contactPageHtml.length} characters)\n` +
        `============================================================`
      );
      console.log(contactPageHtml);
      console.log(`==================== [END CONTACT PAGE HTML] ====================\n`);
    } catch (e) {
      console.error("Failed to read contact page HTML text:", e);
    }
  } else {
    console.log(`[Storefront Fetch] Contact page not found or non-200 at ${storeUrl}/pages/contact`);
  }

  const $home = cheerio.load(homepageHtml);
  const $contact = cheerio.load(contactPageHtml);

  // Helper to fetch and inspect policy pages
  async function fetchPolicy(slug: string): Promise<{
    exists: boolean;
    html: string;
    text: string;
  }> {
    const policyUrl = `${storeUrl}/policies/${slug}`;
    try {
      const res = await fetch(policyUrl, {
        headers: storefrontHeaders,
      });
      if (!res.ok) {
        console.log(`[Policy Fetch] ${policyUrl} returned HTTP status ${res.status}`);
        return { exists: false, html: "", text: "" };
      }
      const html = await res.text();
      console.log(
        `\n============================================================\n` +
        `[FETCHED POLICY HTML] Slug: ${slug} | URL: ${policyUrl} (${html.length} characters)\n` +
        `============================================================`
      );
      console.log(html);
      console.log(`==================== [END POLICY HTML: ${slug}] ====================\n`);

      const $p = cheerio.load(html);
      const title = $p("title").text().toLowerCase();
      const h1Text = $p("h1, h2").first().text().toLowerCase();
      const bodyText = $p("body").text().trim();

      const is404 =
        title.includes("404") ||
        title.includes("page not found") ||
        h1Text.includes("404") ||
        h1Text.includes("page not found") ||
        bodyText.length < 50;

      if (is404) {
        console.log(`[Policy Fetch] Policy ${slug} identified as 404/empty template.`);
        return { exists: false, html: "", text: "" };
      }
      return { exists: true, html, text: bodyText };
    } catch (err) {
      console.error(`[Policy Fetch] Failed to fetch policy at ${policyUrl}:`, err);
      return { exists: false, html: "", text: "" };
    }
  }

  const [refundData, privacyData, termsData, shippingData] =
    await Promise.all([
      fetchPolicy("refund-policy"),
      fetchPolicy("privacy-policy"),
      fetchPolicy("terms-of-service"),
      fetchPolicy("shipping-policy"),
    ]);

  // =============================================================
  // CATEGORY 1: POLICY PAGES (6 Checks)
  // =============================================================

  // Check 1: Refund/return policy page exists
  if (refundData.exists) {
    passedChecks++;
  } else {
    issues.push({
      category: "POLICY",
      severity: "CRITICAL",
      ruleCode: "REFUND_POLICY_EXISTS",
      title: "Missing Refund/Return Policy page",
      description:
        "No active refund policy page was found at /policies/refund-policy. Having a clear return policy is mandatory for merchant compliance.",
      fixGuide:
        "In Shopify Admin, go to Settings > Policies. Draft and publish your Refund Policy.",
    });
  }

  // Check 2: Refund policy contains required disclosure language (timeframe, conditions)
  if (refundData.exists) {
    const text = refundData.text.toLowerCase();
    const hasTimeframe =
      /\b(\d{1,3}\s*(day|days|business days|month|weeks))\b/i.test(text) ||
      text.includes("return window") ||
      text.includes("30 days") ||
      text.includes("14 days");
    const hasConditions =
      text.includes("condition") ||
      text.includes("unused") ||
      text.includes("unworn") ||
      text.includes("original packaging") ||
      text.includes("receipt") ||
      text.includes("proof of purchase") ||
      text.includes("damaged");

    if (hasTimeframe && hasConditions && text.split(/\s+/).length >= 50) {
      passedChecks++;
    } else {
      issues.push({
        category: "POLICY",
        severity: "WARNING",
        ruleCode: "REFUND_POLICY_DISCLOSURE_INCOMPLETE",
        title: "Refund policy missing required disclosure language",
        description:
          "Your refund policy appears incomplete or uses a blank template. It must clearly disclose concrete return timeframes (e.g. 30 days) and acceptable product return conditions.",
        fixGuide:
          "Update your Refund Policy in Settings > Policies to explicitly state the return timeframe (e.g. '30 days') and item condition requirements.",
      });
    }
  } else {
    issues.push({
      category: "POLICY",
      severity: "WARNING",
      ruleCode: "REFUND_POLICY_DISCLOSURE_INCOMPLETE",
      title: "Refund policy disclosures unverified",
      description:
        "Unable to evaluate disclosure language because the refund policy page does not exist.",
      fixGuide:
        "Create and publish your Refund Policy with clear return timeframes and conditions.",
    });
  }

  // Check 3: Shipping policy page exists
  if (shippingData.exists) {
    passedChecks++;
  } else {
    issues.push({
      category: "POLICY",
      severity: "WARNING",
      ruleCode: "SHIPPING_POLICY_EXISTS",
      title: "Missing Shipping Policy page",
      description:
        "No shipping policy found at /policies/shipping-policy. Clear transit and handling disclosures prevent merchant center suspensions.",
      fixGuide:
        "In Shopify Admin, go to Settings > Policies, draft your Shipping Policy, and click Save.",
    });
  }

  // Check 4: Privacy policy page exists
  if (privacyData.exists) {
    passedChecks++;
  } else {
    issues.push({
      category: "POLICY",
      severity: "CRITICAL",
      ruleCode: "PRIVACY_POLICY_EXISTS",
      title: "Missing Privacy Policy page",
      description:
        "A published Privacy Policy is legally required under GDPR, CCPA, and Shopify merchant terms.",
      fixGuide:
        "Go to Shopify Admin > Settings > Policies and create your Privacy Policy.",
    });
  }

  // Check 5: Terms of service page exists
  if (termsData.exists) {
    passedChecks++;
  } else {
    issues.push({
      category: "POLICY",
      severity: "WARNING",
      ruleCode: "TERMS_POLICY_EXISTS",
      title: "Missing Terms of Service page",
      description:
        "No Terms of Service policy found at /policies/terms-of-service.",
      fixGuide:
        "Go to Shopify Admin > Settings > Policies, create your Terms of Service, and click Save.",
    });
  }

  // Check 6: Policy pages are linked/accessible from storefront footer (not orphaned)
  const footerSections = $home(
    'footer, [class*="footer"], [id*="footer"], [class*="footer-group"], [class*="footer-utilities"], [class*="policy"], [id*="policy"], [id*="policies"]'
  );

  const realFooterHtml =
    $home("footer").html() ||
    $home('[class*="footer-utilities"]').html() ||
    $home('[class*="footer-group"]').html() ||
    footerSections.first().html() ||
    "No footer element found";

  console.log(
    `\n============================================================\n` +
    `[EXTRACTED FOOTER HTML FOR POLICY & PAYMENT CHECKS]\n` +
    `============================================================\n` +
    realFooterHtml +
    `\n==================== [END EXTRACTED FOOTER HTML] ====================\n`
  );

  const footerHrefsList: string[] = [];
  footerSections.find("a").each((_, el) => {
    const href = $home(el).attr("href");
    if (href) footerHrefsList.push(href.toLowerCase());
  });

  // Also include any <a> tag in the homepage DOM pointing to /policies/
  $home('a[href*="/policies/"]').each((_, el) => {
    const href = $home(el).attr("href");
    if (href) footerHrefsList.push(href.toLowerCase());
  });

  const footerHrefs = footerHrefsList.join(" ");

  const hasRefundLink =
    footerHrefs.includes("refund") || footerHrefs.includes("return");
  const hasPrivacyLink = footerHrefs.includes("privacy");
  const hasTermsLink = footerHrefs.includes("terms");
  const hasShippingLink = footerHrefs.includes("shipping");

  const linkedCount = [
    hasRefundLink,
    hasPrivacyLink,
    hasTermsLink,
    hasShippingLink,
  ].filter(Boolean).length;

  const publishedPoliciesCount = [
    refundData.exists,
    privacyData.exists,
    termsData.exists,
    shippingData.exists,
  ].filter(Boolean).length;

  const minimumRequiredLinks = Math.min(2, Math.max(1, publishedPoliciesCount));

  if (linkedCount >= minimumRequiredLinks) {
    passedChecks++;
  } else {
    issues.push({
      category: "POLICY",
      severity: "CRITICAL",
      ruleCode: "POLICIES_NOT_IN_FOOTER",
      title: "Policy pages not linked in storefront footer",
      description:
        "Your policies exist, but they are not linked in the storefront footer menu. Ad platforms and payment gateways flag stores where policies are orphaned or hidden.",
      fixGuide:
        "Go to Online Store > Navigation > Footer menu. Add menu items linking to your published Policies.",
    });
  }

  // =============================================================
  // CATEGORY 2: CONTACT & BUSINESS IDENTITY (5 Checks)
  // =============================================================

  const combinedDomText = `${homepageHtml} ${contactPageHtml}`.toLowerCase();

  // Check 7: Phone number present and visible on storefront
  const hasTelLink =
    $home('a[href^="tel:"]').length > 0 || $contact('a[href^="tel:"]').length > 0;
  const hasPhoneRegex =
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(
      $home("footer").text() + " " + contactPageHtml
    );

  if (hasTelLink || hasPhoneRegex) {
    passedChecks++;
  } else {
    issues.push({
      category: "IDENTITY",
      severity: "WARNING",
      ruleCode: "PHONE_NUMBER_VISIBLE",
      title: "Phone number not found on storefront",
      description:
        "No customer support phone number or clickable tel: link was found in your footer or Contact page.",
      fixGuide:
        "Add a visible support phone number to your footer or Contact page (<a href='tel:+1...'>Call Us</a>).",
    });
  }

  // Check 8: Email/contact form present and visible
  const hasMailto =
    $home('a[href^="mailto:"]').length > 0 ||
    $contact('a[href^="mailto:"]').length > 0;
  const hasContactForm =
    $contact('form[action*="/contact"]').length > 0 ||
    $home('form[action*="/contact"]').length > 0;
  const hasEmailString =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(
      $home("footer").text() + " " + contactPageHtml
    ) || Boolean(shopData?.contactEmail);

  if (hasMailto || hasContactForm || hasEmailString) {
    passedChecks++;
  } else {
    issues.push({
      category: "IDENTITY",
      severity: "CRITICAL",
      ruleCode: "EMAIL_OR_FORM_VISIBLE",
      title: "No customer support email or contact form found",
      description:
        "Shoppers cannot find a clear way to contact your business. A visible email or contact form is mandatory for merchant verification.",
      fixGuide:
        "Add your customer support email address or embed a contact form on your storefront.",
    });
  }

  // Check 9: Physical business address present
  const ADDRESS_TERMS = [
    "street",
    " st.",
    "road",
    " rd.",
    "avenue",
    " ave.",
    "boulevard",
    " blvd.",
    "suite",
    " ste.",
    "floor",
    "building",
    "po box",
    "postal code",
    "zip code",
  ];
  const hasAddress = ADDRESS_TERMS.some((term) =>
    combinedDomText.includes(term)
  );

  if (hasAddress) {
    passedChecks++;
  } else {
    issues.push({
      category: "IDENTITY",
      severity: "WARNING",
      ruleCode: "PHYSICAL_ADDRESS_VISIBLE",
      title: "Physical business address not displayed",
      description:
        "No physical business address was detected in your footer, contact page, or terms of service.",
      fixGuide:
        "Add your registered business address to your footer or Contact Us page.",
    });
  }

  // Check 10: Business name on storefront matches legal name in Shopify settings
  const shopLegalName = (shopData?.name || "").toLowerCase().trim();
  const normalizedShopName = shopLegalName.replace(/[-_]/g, " ");
  const pageTitle = $home("title").text().toLowerCase();
  const footerText = $home('footer, [class*="footer"], [id*="footer"]').text().toLowerCase();
  const headerText = $home('header, [class*="header"], [id*="header"]').text().toLowerCase();
  const fullBodyText = $home("body").text().toLowerCase();

  const businessNameMatches =
    Boolean(shopLegalName) &&
    (pageTitle.includes(shopLegalName) ||
      pageTitle.includes(normalizedShopName) ||
      footerText.includes(shopLegalName) ||
      footerText.includes(normalizedShopName) ||
      headerText.includes(shopLegalName) ||
      headerText.includes(normalizedShopName) ||
      fullBodyText.includes(shopLegalName) ||
      fullBodyText.includes(normalizedShopName));

  if (businessNameMatches) {
    passedChecks++;
  } else {
    issues.push({
      category: "IDENTITY",
      severity: "WARNING",
      ruleCode: "BUSINESS_NAME_MISMATCH",
      title: "Storefront branding does not match Shopify store name",
      description: `Your configured store name is "${shopData?.name}", but this name was not clearly found in your homepage title, header, or footer copyright.`,
      fixGuide:
        "Align your storefront title and footer copyright with your store name in Settings > General.",
    });
  }

  // Check 11: Address on storefront matches the address configured for Merchant Center
  const billing = shopData?.billingAddress;
  const hasBillingConfigured = Boolean(billing?.country || billing?.city);
  const addressMatchesStorefront =
    hasBillingConfigured &&
    ((billing?.city && combinedDomText.includes(billing.city.toLowerCase())) ||
      (billing?.country &&
        combinedDomText.includes(billing.country.toLowerCase())) ||
      (billing?.address1 &&
        combinedDomText.includes(billing.address1.toLowerCase())));

  if (addressMatchesStorefront) {
    passedChecks++;
  } else {
    issues.push({
      category: "IDENTITY",
      severity: "INFO",
      ruleCode: "MERCHANT_CENTER_ADDRESS_VERIFY",
      title: "Storefront address requires manual Merchant Center verification",
      description:
        "Could not automatically verify that the physical address displayed on your storefront exactly matches your registered Merchant Center / Shopify billing address.",
      fixGuide:
        "Manually confirm that your displayed storefront address matches your Google Merchant Center business registration.",
    });
  }

  // =============================================================
  // CATEGORY 3: PRODUCT FEED / LISTINGS (5 Checks)
  // =============================================================

  // Check 12: Products have GTIN/barcode where required by category
  let missingBarcodes = 0;
  for (const product of products) {
    for (const variant of product.variants?.nodes || []) {
      if (!variant.barcode || variant.barcode.trim() === "") {
        missingBarcodes++;
      }
    }
  }

  if (missingBarcodes === 0 && products.length > 0) {
    passedChecks++;
  } else if (products.length === 0) {
    passedChecks++;
  } else {
    issues.push({
      category: "PRODUCT_FEED",
      severity: "WARNING",
      ruleCode: "MISSING_GTIN_BARCODE",
      title: `${missingBarcodes} product variants missing Barcodes/GTINs`,
      description:
        "Products listed on Google Shopping and Meta feeds require valid barcodes (GTIN, UPC, EAN, or ISBN).",
      fixGuide:
        "Open Products in Shopify Admin, edit your variants, and provide valid Barcodes (GTIN).",
    });
  }

  // Check 13: Product prices on storefront match feed pricing (no live mismatch)
  let priceMismatchCount = 0;
  for (const p of products) {
    const storefrontMatch = storefrontProductsJson.find(
      (sp) => String(sp.id) === String(p.id.split("/").pop())
    );
    if (storefrontMatch && storefrontMatch.variants?.length > 0) {
      const livePrice = parseFloat(storefrontMatch.variants[0].price);
      const graphPrice = parseFloat(p.variants?.nodes?.[0]?.price || "0");
      if (
        !isNaN(livePrice) &&
        !isNaN(graphPrice) &&
        Math.abs(livePrice - graphPrice) > 0.05
      ) {
        priceMismatchCount++;
      }
    }
  }

  if (priceMismatchCount === 0) {
    passedChecks++;
  } else {
    issues.push({
      category: "PRODUCT_FEED",
      severity: "CRITICAL",
      ruleCode: "PRICE_MISMATCH_FEED",
      title: `${priceMismatchCount} products have price discrepancies between feed and live store`,
      description:
        "A price mismatch was detected between live storefront JSON and catalog data. This is a primary cause for Google Merchant Center suspensions.",
      fixGuide:
        "Verify your currency conversion apps and make sure prices shown on product pages match your catalog prices.",
    });
  }

  // Check 14: Product images present for all active products (no missing/placeholder images)
  let missingImageCount = 0;
  for (const product of products) {
    const imgUrl = product.featuredImage?.url || "";
    if (!imgUrl || imgUrl.includes("no-image") || imgUrl.includes("placeholder")) {
      missingImageCount++;
    }
  }

  if (missingImageCount === 0 && products.length > 0) {
    passedChecks++;
  } else if (products.length === 0) {
    passedChecks++;
  } else {
    issues.push({
      category: "PRODUCT_FEED",
      severity: "CRITICAL",
      ruleCode: "MISSING_PRODUCT_IMAGES",
      title: `${missingImageCount} active products missing images`,
      description:
        "Found active products without images or using placeholder placeholders. Ad networks reject listings without images.",
      fixGuide:
        "Upload high-quality product images to all active products in Shopify Admin.",
    });
  }

  // Check 15: Product descriptions flagged for risky promotional language
  const RISKY_SUPERLATIVES = [
    "best deal ever",
    "lowest price guaranteed",
    "guaranteed lowest price",
    "100% satisfaction guaranteed",
    "miracle cure",
    "100% cure",
    "unbeatable price",
    "risk free",
    "number 1 in the world",
    "cheapest on the internet",
    "guaranteed weight loss",
  ];

  let riskyProductsCount = 0;
  const flaggedDetails: string[] = [];

  for (const product of products) {
    const textToScan = `${product.title} ${product.descriptionHtml}`.toLowerCase();
    for (const term of RISKY_SUPERLATIVES) {
      if (textToScan.includes(term)) {
        riskyProductsCount++;
        flaggedDetails.push(`"${term}" in ${product.title}`);
        break;
      }
    }
  }

  if (riskyProductsCount === 0) {
    passedChecks++;
  } else {
    issues.push({
      category: "AUP_RISK",
      severity: "WARNING",
      ruleCode: "RISKY_PROMOTIONAL_LANGUAGE",
      title: `${riskyProductsCount} products contain unverifiable promotional claims`,
      description: `Detected high-risk superlatives (${flaggedDetails.slice(0, 3).join(", ")}). Unverifiable claims violate Google Misrepresentation and Shopify AUP.`,
      fixGuide:
        "Edit affected product descriptions and remove superlatives like 'guaranteed', 'best deal ever', or absolute medical claims.",
    });
  }

  // Check 16: Product availability status accurate (in-stock/out-of-stock matches actual inventory)
  let availabilityMismatch = false;
  for (const p of products) {
    const sfProduct = storefrontProductsJson.find(
      (sp) => String(sp.id) === String(p.id.split("/").pop())
    );
    if (sfProduct && sfProduct.variants?.length > 0) {
      const sfAvailable = Boolean(sfProduct.variants[0].available);
      const graphAvailable = Boolean(p.variants?.nodes?.[0]?.availableForSale);
      if (sfAvailable !== graphAvailable) {
        availabilityMismatch = true;
        break;
      }
    }
  }

  if (!availabilityMismatch) {
    passedChecks++;
  } else {
    issues.push({
      category: "PRODUCT_FEED",
      severity: "WARNING",
      ruleCode: "INVENTORY_AVAILABILITY_MISMATCH",
      title: "Product availability status discrepancy detected",
      description:
        "Storefront product availability does not consistently match catalog inventory records.",
      fixGuide:
        "Verify your inventory tracking settings and ensure out-of-stock items are accurately marked in your theme.",
    });
  }

  // =============================================================
  // CATEGORY 4: CHECKOUT & TRUST SIGNALS (2 Checks)
  // =============================================================

  // Check 17: Payment methods visibly displayed (not hidden behind checkout only)
  const hasPaymentIcons =
    footerSections.find(
      '[class*="payment"], [class*="payment-icon"], [class*="payment_methods"], svg[aria-label*="payment"], img[src*="visa"], img[src*="mastercard"], img[src*="payment"]'
    ).length > 0 ||
    $home(
      '[class*="payment-icon"], [class*="payment_methods"], svg[aria-label*="payment"]'
    ).length > 0;

  if (hasPaymentIcons) {
    passedChecks++;
  } else {
    issues.push({
      category: "TRUST_SIGNALS",
      severity: "WARNING",
      ruleCode: "PAYMENT_METHODS_NOT_VISIBLE",
      title: "Payment methods not visibly displayed on storefront",
      description:
        "Accepted payment methods (Visa, Mastercard, PayPal) should be clearly displayed in the footer before checkout to comply with transparency rules.",
      fixGuide:
        "In Online Store > Themes > Customize, navigate to the Footer section and toggle 'Show payment icons' on.",
    });
  }

  // Check 18: Store has an active SSL / secure checkout
  const isSslActive =
    storeUrl.startsWith("https://") &&
    shopData?.primaryDomain?.sslEnabled !== false;

  if (isSslActive) {
    passedChecks++;
  } else {
    issues.push({
      category: "TRUST_SIGNALS",
      severity: "CRITICAL",
      ruleCode: "SSL_SECURE_CHECKOUT",
      title: "Active SSL secure connection not verified",
      description:
        "Your storefront must enforce HTTPS encryption across all pages and checkout.",
      fixGuide:
        "In Online Store > Domains, ensure SSL status is active and traffic is routed via HTTPS.",
    });
  }

  // -------------------------------------------------------------
  // 3. Compute Scores and Persist to PostgreSQL
  // -------------------------------------------------------------
  const score = Math.round((passedChecks / totalChecks) * 100);

  const policyIssues = issues.filter((i) => i.category === "POLICY").length;
  const identityIssues = issues.filter((i) => i.category === "IDENTITY").length;
  const feedIssues = issues.filter(
    (i) => i.category === "PRODUCT_FEED" || i.category === "AUP_RISK"
  ).length;
  const trustIssues = issues.filter(
    (i) => i.category === "TRUST_SIGNALS"
  ).length;

  const categoryScores = {
    policy: Math.max(0, Math.round(((6 - policyIssues) / 6) * 100)),
    identity: Math.max(0, Math.round(((5 - identityIssues) / 5) * 100)),
    feed: Math.max(0, Math.round(((5 - feedIssues) / 5) * 100)),
    trust: Math.max(0, Math.round(((2 - trustIssues) / 2) * 100)),
  };

  await prisma.$transaction([
    prisma.issue.deleteMany({ where: { shopId: shopDomain } }),
    prisma.scan.create({
      data: {
        shopId: shopDomain,
        score,
        totalChecks,
        passedChecks,
        failedChecks: totalChecks - passedChecks,
        categoryScores,
      },
    }),
    prisma.issue.createMany({
      data: issues.map((iss) => ({
        shopId: shopDomain,
        category: iss.category,
        severity: iss.severity,
        ruleCode: iss.ruleCode,
        title: iss.title,
        description: iss.description,
        fixGuide: iss.fixGuide,
      })),
    }),
    prisma.shop.update({
      where: { shopDomain },
      data: {
        complianceScore: score,
        lastScannedAt: new Date(),
      },
    }),
  ]);

  console.log(
    `[Scanner] Completed 18 checks for ${shopDomain}. Score: ${score}/100. Passed: ${passedChecks}/18. Issues: ${issues.length}.`
  );

  return { score, passedChecks, totalChecks, categoryScores, issues };
}

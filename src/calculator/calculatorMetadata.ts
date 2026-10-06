import { useEffect } from "react";

export const CALCULATOR_PAGE_TITLE = "Seisan: Free Group Expense Calculator, See Who Pays Whom";
const PAGE_DESCRIPTION =
  "Split a group expense equally, by ratio, or with custom amounts and get a clear settlement plan. Free, private to your browser, and no sign-up required.";
const SOFTWARE_APPLICATION_ID = "seisan-calculator-structured-data";

/**
 * Root-route SEO: rewrites the description, Open Graph, and Twitter metadata from `index.html` and
 * attaches `SoftwareApplication` structured data, removed again on unmount.
 */
export function useCalculatorMetadata() {
  useEffect(() => {
    setMetaContent('meta[name="description"]', PAGE_DESCRIPTION);
    setMetaContent('meta[property="og:title"]', CALCULATOR_PAGE_TITLE);
    setMetaContent('meta[property="og:description"]', PAGE_DESCRIPTION);
    setMetaContent('meta[name="twitter:title"]', CALCULATOR_PAGE_TITLE);
    setMetaContent('meta[name="twitter:description"]', PAGE_DESCRIPTION);

    const existing = document.getElementById(SOFTWARE_APPLICATION_ID);
    existing?.remove();
    const script = document.createElement("script");
    script.id = SOFTWARE_APPLICATION_ID;
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Seisan Group Expense Calculator",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      url: "https://seisan.waga.me/",
      description: PAGE_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    });
    document.head.append(script);
    return () => script.remove();
  }, []);
}

function setMetaContent(selector: string, content: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", content);
}

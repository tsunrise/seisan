import { Box, Button, CircularProgress, Stack } from "@mui/material";
import { useEffect, useState } from "react";

import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors, ledgerFonts } from "../theme";

// Generated from privacy_policy.md by scripts/build-privacy-policy.mjs.
const PRIVACY_POLICY_HTML_PATH = "/privacy_policy.html";

export function PrivacyPage() {
  const [policyHtml, setPolicyHtml] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useDocumentTitle("Privacy Policy - Seisan");

  useEffect(() => {
    const abortController = new AbortController();

    void fetch(PRIVACY_POLICY_HTML_PATH, {
      headers: { Accept: "text/html" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load privacy policy: ${response.status}`);
        }
        return response.text();
      })
      .then((html) => {
        setPolicyHtml(html);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadFailed(true);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [loadAttempt]);

  return (
    <Box
      component="main"
      sx={{ width: "min(720px, 100%)", mx: "auto", px: 2, py: { xs: 3, md: 5 } }}
    >
      <BrandLink />

      {loadFailed ? (
        <Stack spacing={2} sx={{ alignItems: "flex-start", mt: 6 }}>
          <InlineAlert>
            Could not load the privacy policy. Check your connection and try again.
          </InlineAlert>
          <Button
            variant="outlined"
            onClick={() => {
              setPolicyHtml(null);
              setLoadFailed(false);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Retry
          </Button>
        </Stack>
      ) : null}

      {!loadFailed && policyHtml === null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
          <CircularProgress aria-label="Loading privacy policy" />
        </Box>
      ) : null}

      {policyHtml ? (
        <Box
          sx={{
            lineHeight: 1.65,
            overflowWrap: "anywhere",
            "& h1": {
              mt: 4,
              mb: 1,
              fontFamily: ledgerFonts.serif,
              fontSize: { xs: 32, md: 40 },
              fontWeight: 600,
              lineHeight: 1.15,
            },
            "& h2": {
              mt: 5,
              mb: 1,
              fontSize: 20,
              fontWeight: 750,
              scrollMarginTop: 16,
            },
            "& p, & ul": { my: 1.5 },
            "& li + li": { mt: 0.75 },
            "& a": { color: ledgerColors.blueDark },
            "& code": { fontFamily: ledgerFonts.mono, fontSize: "0.9em" },
          }}
          dangerouslySetInnerHTML={{ __html: policyHtml }}
        />
      ) : null}
    </Box>
  );
}

import { useEffect, useState } from "react";
import { Box, CircularProgress, Paper } from "@mui/material";

import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { paperFrameSx } from "../components/styles";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const PRIVACY_POLICY_HTML_PATH = "/privacy_policy.html";

export function PrivacyPage() {
  const [policyHtml, setPolicyHtml] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useDocumentTitle("Privacy Policy - Seisan");

  useEffect(() => {
    let mounted = true;

    void fetch(PRIVACY_POLICY_HTML_PATH, {
      headers: { Accept: "text/html" },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load privacy policy: ${response.status}`);
        }
        return response.text();
      })
      .then((html) => {
        if (mounted) {
          setPolicyHtml(html);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadFailed(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Box component="main" sx={{ minHeight: "100svh", p: { xs: 2, sm: 3 } }}>
      <Box sx={{ width: "min(860px, 100%)", mx: "auto" }}>
        <BrandLink sx={{ mb: 2 }} />
        <Paper square sx={{ ...paperFrameSx, p: { xs: 2.5, sm: 3.5 } }}>
          {loadFailed ? <InlineAlert>Could not load the privacy policy.</InlineAlert> : null}
          {!loadFailed && policyHtml === null ? <CircularProgress size={24} /> : null}
          {policyHtml ? (
            <Box
              sx={{
                color: "text.primary",
                fontSize: 15,
                lineHeight: 1.65,
                overflowWrap: "anywhere",
                "& h1": {
                  mt: 0,
                  mb: 2,
                  fontSize: { xs: 32, sm: 42 },
                  lineHeight: 1.05,
                },
                "& h2": {
                  mt: 3.5,
                  mb: 1,
                  fontSize: 22,
                  lineHeight: 1.2,
                },
                "& h3": {
                  mt: 2.5,
                  mb: 0.75,
                  fontSize: 17,
                  lineHeight: 1.25,
                },
                "& p": {
                  my: 1.1,
                },
                "& ul": {
                  my: 1.1,
                  pl: 3,
                },
                "& li": {
                  mb: 0.45,
                },
                "& a": {
                  color: "primary.main",
                  fontWeight: 700,
                },
              }}
              dangerouslySetInnerHTML={{ __html: policyHtml }}
            />
          ) : null}
        </Paper>
      </Box>
    </Box>
  );
}

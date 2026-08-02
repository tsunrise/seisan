import { useEffect, useState } from "react";
import { Box, Button, Skeleton, Stack, Typography } from "@mui/material";

import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors, ledgerFonts } from "../theme";

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
      sx={{ minHeight: "100svh", bgcolor: ledgerColors.paperBg, color: ledgerColors.ink }}
    >
      <Box
        component="a"
        href="#privacy-policy-content"
        sx={{
          position: "fixed",
          zIndex: 10,
          top: 12,
          left: 12,
          px: 1.5,
          py: 1,
          bgcolor: ledgerColors.ink,
          color: ledgerColors.paper,
          fontWeight: 800,
          textDecoration: "none",
          transform: "translateY(-180%)",
          transition: "transform 120ms ease",
          "&:focus": { transform: "translateY(0)", outline: `3px solid ${ledgerColors.blue}` },
        }}
      >
        Skip to policy
      </Box>

      <Box sx={{ width: "min(1180px, 100%)", mx: "auto", px: { xs: 2, sm: 3.5, lg: 5 } }}>
        <Box
          component="header"
          sx={{
            minHeight: { xs: 68, sm: 76 },
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            borderBottom: `1px solid ${ledgerColors.line}`,
          }}
        >
          <BrandLink />
          <Typography
            component="p"
            sx={{
              m: 0,
              color: ledgerColors.muted,
              fontFamily: ledgerFonts.mono,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Legal / Privacy
          </Typography>
        </Box>

        {loadFailed ? (
          <Box sx={{ width: "min(680px, 100%)", mx: "auto", py: { xs: 8, md: 14 } }}>
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
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
          </Box>
        ) : null}

        {!loadFailed && policyHtml === null ? <PrivacyPolicySkeleton /> : null}

        {policyHtml ? (
          <Box
            sx={{
              pb: { xs: 9, md: 15 },
              overflowWrap: "anywhere",
              "& .privacy-policy__header": {
                width: "min(780px, 100%)",
                pt: { xs: 7, sm: 9, md: 12 },
                pb: { xs: 7, md: 10 },
              },
              "& .privacy-policy__header h1": {
                maxWidth: "12ch",
                m: 0,
                mb: 3,
                fontFamily: ledgerFonts.serif,
                fontSize: { xs: 42, sm: 56, md: 64 },
                fontWeight: 650,
                letterSpacing: "-0.035em",
                lineHeight: 0.98,
              },
              "& .privacy-policy__header p": {
                maxWidth: "68ch",
                my: 1.25,
                fontSize: 16,
                lineHeight: 1.7,
              },
              "& .privacy-policy__header p:nth-of-type(-n + 2)": {
                display: "inline",
                color: ledgerColors.muted,
                fontFamily: ledgerFonts.mono,
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: "0.035em",
                lineHeight: 1.4,
              },
              "& .privacy-policy__header p:nth-of-type(1)::after": {
                content: '" / "',
                color: ledgerColors.lineStrong,
              },
              "& .privacy-policy__header p:nth-of-type(3)": { mt: 3.5 },
              "& .privacy-policy__layout": {
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "220px minmax(0, 68ch)" },
                justifyContent: "center",
                gap: { xs: 4, md: 6, lg: 10 },
                alignItems: "start",
              },
              "& .privacy-policy__toc": {
                position: { md: "sticky" },
                top: { md: 24 },
                maxHeight: { md: "calc(100svh - 48px)" },
                overflowY: { md: "auto" },
                borderBlock: `1px solid ${ledgerColors.line}`,
                color: ledgerColors.muted,
              },
              "& .privacy-policy__toc summary": {
                display: "flex",
                justifyContent: "space-between",
                gap: 2,
                py: 1.5,
                color: ledgerColors.ink,
                cursor: "pointer",
                fontFamily: ledgerFonts.mono,
                fontSize: 11.5,
                fontWeight: 800,
                letterSpacing: "0.055em",
                textTransform: "uppercase",
                listStylePosition: "inside",
              },
              "& .privacy-policy__toc summary span": {
                color: ledgerColors.muted,
                fontWeight: 500,
                letterSpacing: 0,
                textTransform: "none",
              },
              "& .privacy-policy__toc summary:focus-visible": {
                outline: `2px solid ${ledgerColors.blue}`,
                outlineOffset: 3,
              },
              "& .privacy-policy__toc nav": { pb: 1.5 },
              "& .privacy-policy__toc ol": { m: 0, p: 0, listStyle: "none" },
              "& .privacy-policy__toc li": { m: 0 },
              "& .privacy-policy__toc a": {
                display: "block",
                py: 0.55,
                pr: 1,
                color: ledgerColors.muted,
                fontSize: 12.5,
                lineHeight: 1.35,
                textDecoration: "none",
                transition: "color 120ms ease, transform 120ms ease",
              },
              "& .privacy-policy__toc a:hover": {
                color: ledgerColors.blueDark,
                transform: "translateX(2px)",
              },
              "& .privacy-policy__toc a:focus-visible": {
                color: ledgerColors.blueDark,
                outline: `2px solid ${ledgerColors.blue}`,
                outlineOffset: 2,
              },
              "& .privacy-policy__sections": { minWidth: 0 },
              "& .privacy-policy__section": {
                py: { xs: 4.5, md: 6 },
                borderTop: `1px solid ${ledgerColors.line}`,
              },
              "& .privacy-policy__section:first-of-type": { borderTop: 0, pt: 0 },
              "& .privacy-policy__section h2": {
                m: 0,
                mb: 2.25,
                scrollMarginTop: 24,
                fontFamily: ledgerFonts.serif,
                fontSize: { xs: 29, sm: 34 },
                fontWeight: 650,
                letterSpacing: "-0.02em",
                lineHeight: 1.12,
              },
              "& .privacy-policy__section h3": {
                m: 0,
                mt: 4,
                mb: 1.25,
                scrollMarginTop: 24,
                fontSize: 17,
                fontWeight: 800,
                lineHeight: 1.35,
              },
              "& .privacy-policy__section p, & .privacy-policy__section li": {
                fontSize: 16,
                lineHeight: 1.74,
              },
              "& .privacy-policy__section p": { my: 1.35 },
              "& .privacy-policy__section ul": { my: 1.5, pl: 2.75 },
              "& .privacy-policy__section li": { mb: 0.75, pl: 0.5 },
              "& .privacy-policy__section strong": { fontWeight: 800 },
              "& .privacy-policy__section code": {
                px: 0.25,
                bgcolor: ledgerColors.paperSoft,
                fontFamily: ledgerFonts.mono,
                fontSize: "0.9em",
              },
              "& .privacy-policy__section--summary": {
                py: { xs: 3.5, sm: 4.5 },
                px: { xs: 2, sm: 3 },
                mb: 2,
                bgcolor: ledgerColors.paperSoft,
                borderBlock: `1px solid ${ledgerColors.lineStrong}`,
              },
              "& .privacy-policy__section--summary ul": {
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                columnGap: 4,
                m: 0,
                p: 0,
                listStyle: "none",
              },
              "& .privacy-policy__section--summary li": {
                m: 0,
                py: 2,
                pl: 0,
                borderBottom: `1px solid ${ledgerColors.line}`,
              },
              "& .privacy-policy__section--summary li:nth-last-of-type(-n + 2)": {
                borderBottom: { sm: 0 },
              },
              "& .privacy-policy__section--summary li:last-of-type": { borderBottom: 0 },
              "& #project-visibility-and-other-users + p, & #right-to-object + p": {
                my: 2.5,
                px: 2.25,
                py: 1.75,
                bgcolor: ledgerColors.blueSoft,
                borderLeft: `3px solid ${ledgerColors.blue}`,
                color: ledgerColors.blueDark,
              },
              "& a": {
                color: ledgerColors.blueDark,
                fontWeight: 700,
                textDecorationColor: ledgerColors.lineStrong,
                textUnderlineOffset: "0.16em",
              },
              "& a:hover": { textDecorationColor: ledgerColors.blueDark },
              "& a:focus-visible": {
                outline: `2px solid ${ledgerColors.blue}`,
                outlineOffset: 3,
                borderRadius: "1px",
              },
              '& a[target="_blank"]::after': { content: '" ↗"', fontFamily: ledgerFonts.mono },
            }}
            dangerouslySetInnerHTML={{ __html: policyHtml }}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function PrivacyPolicySkeleton() {
  return (
    <Box aria-busy="true" aria-label="Loading privacy policy" sx={{ pb: 12 }}>
      <Box sx={{ width: "min(780px, 100%)", pt: { xs: 7, md: 12 }, pb: { xs: 7, md: 10 } }}>
        <Skeleton
          variant="rectangular"
          animation="wave"
          sx={{
            width: "min(520px, 84vw)",
            height: { xs: 84, sm: 112 },
            bgcolor: ledgerColors.line,
          }}
        />
        <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
          <Skeleton sx={{ width: 132, bgcolor: ledgerColors.line }} />
          <Skeleton sx={{ width: 132, bgcolor: ledgerColors.line }} />
        </Stack>
        <Skeleton sx={{ width: "min(680px, 100%)", mt: 3, bgcolor: ledgerColors.line }} />
        <Skeleton sx={{ width: "min(610px, 90%)", bgcolor: ledgerColors.line }} />
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 68ch)" },
          justifyContent: "center",
          gap: { xs: 4, md: 6, lg: 10 },
        }}
      >
        <Stack spacing={1} sx={{ borderBlock: `1px solid ${ledgerColors.line}`, py: 2 }}>
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton
              key={index}
              sx={{ width: `${82 - index * 4}%`, bgcolor: ledgerColors.line }}
            />
          ))}
        </Stack>
        <Stack spacing={1.25} sx={{ borderTop: `1px solid ${ledgerColors.line}`, pt: 4 }}>
          <Skeleton sx={{ width: "45%", height: 42, bgcolor: ledgerColors.line }} />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton
              key={index}
              sx={{ width: index === 5 ? "68%" : "100%", bgcolor: ledgerColors.line }}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

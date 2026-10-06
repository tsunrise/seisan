import AltRouteOutlinedIcon from "@mui/icons-material/AltRouteOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import MoneyOffOutlinedIcon from "@mui/icons-material/MoneyOffOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { BrandLink } from "../components/BrandLink";
import { ledgerColors, ledgerFonts } from "../theme";

const projectFeatures = [
  {
    title: "Track every expense together.",
    copy: "Stop computing the total by hand. Record every expense and collaborate.",
    Icon: GroupsOutlinedIcon,
  },
  {
    title: "Everyone gets a personalized transfer plan.",
    copy: "It is more powerful than the calculator above, for sure.",
    Icon: AltRouteOutlinedIcon,
  },
  {
    title: "Free without daily posting cap.",
    copy: "A PRO subscription just for tracking expenses? Come on. You don't need it. We don't offer it.",
    Icon: MoneyOffOutlinedIcon,
  },
];

/**
 * Always-visible conversion section for visitors who need itemized tracking in a shared project.
 * Discloses that full projects store data on Seisan's servers.
 */
export function ProjectConversionSection({ signedIn }: { signedIn: boolean }) {
  return (
    <Box
      component="section"
      aria-labelledby="seisan-project-heading"
      sx={{
        borderTop: `1px solid ${ledgerColors.line}`,
        borderBottom: `1px solid ${ledgerColors.line}`,
        bgcolor: ledgerColors.paper,
      }}
    >
      <Box
        sx={{
          width: "min(1060px, 100%)",
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: { xs: 6, md: 8 },
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "0.9fr 1.1fr" },
            gap: { xs: 4, md: 8 },
            alignItems: "start",
          }}
        >
          <Stack spacing={2.25} sx={{ alignItems: "flex-start" }}>
            <Typography
              id="seisan-project-heading"
              component="h2"
              sx={{
                fontFamily: ledgerFonts.serif,
                fontSize: { xs: 34, md: 42 },
                fontWeight: 700,
                lineHeight: 1.05,
              }}
            >
              Too many expenses to track?
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ maxWidth: { xs: "100%", md: 430 }, lineHeight: 1.65 }}
            >
              We got you covered. Try a shared project and record expenses as they happen instead of
              rebuilding the total by hand.
            </Typography>
            <Button
              component={Link}
              to={signedIn ? "/projects/new" : "/login?returnTo=%2Fprojects%2Fnew"}
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              sx={{
                alignSelf: { xs: "stretch", sm: "flex-start" },
                whiteSpace: "nowrap",
              }}
            >
              {signedIn ? "Create a shared project" : "Sign in to start a shared project"}
            </Button>
          </Stack>

          <Stack divider={<Divider flexItem />} spacing={0}>
            {projectFeatures.map(({ title, copy, Icon }) => (
              <Box
                key={title}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr)",
                  gap: 1.5,
                  py: 2.25,
                }}
              >
                <Icon
                  aria-hidden="true"
                  sx={{ mt: 0.125, color: ledgerColors.blueDark, fontSize: 22 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6 }}>
                    {copy}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          sx={{
            mt: { xs: 3.5, md: 4.5 },
            pt: 2,
            alignItems: "flex-start",
            borderTop: `1px solid ${ledgerColors.line}`,
            color: "text.secondary",
          }}
        >
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.6 }}>
            Full Seisan projects store expense data on Seisan&apos;s servers so collaborators can
            stay in sync. Seisan uses access controls and other safeguards to protect project data.
            See the <PrivacyPolicyLink />.
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

/** Visible FAQ content. Do not add FAQ rich-result markup. */
export function CalculatorFaqSection() {
  return (
    <Box
      component="section"
      aria-labelledby="faq-heading"
      sx={{
        width: "min(860px, 100%)",
        mx: "auto",
        px: { xs: 2, sm: 3 },
        pt: { xs: 6, md: 8 },
        pb: { xs: 7, md: 10 },
      }}
    >
      <Typography
        id="faq-heading"
        component="h2"
        sx={{
          mb: 3,
          fontFamily: ledgerFonts.serif,
          fontSize: { xs: 34, md: 42 },
          fontWeight: 700,
        }}
      >
        Frequently asked questions
      </Typography>
      {FAQS.map(({ question, answer }) => (
        <Accordion
          key={question}
          disableGutters
          elevation={0}
          square
          sx={{
            borderTop: `1px solid ${ledgerColors.line}`,
            bgcolor: "transparent",
            "&:last-of-type": { borderBottom: `1px solid ${ledgerColors.line}` },
            "&::before": { display: "none" },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 800 }}>{question}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography color="text.secondary" sx={{ lineHeight: 1.65 }}>
              {answer}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}

export function CalculatorFooter() {
  return (
    <Stack
      component="footer"
      direction={{ xs: "column", sm: "row" }}
      sx={{
        width: "min(1180px, 100%)",
        mx: "auto",
        px: { xs: 2, sm: 3 },
        py: 3,
        borderTop: `1px solid ${ledgerColors.line}`,
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
        gap: 1.5,
      }}
    >
      <BrandLink size="compact" />
      <Stack direction="row" spacing={2}>
        <Typography
          component={Link}
          to="/privacy"
          color="text.secondary"
          sx={{ fontSize: 13, fontWeight: 700 }}
        >
          Privacy
        </Typography>
        <Typography
          component={Link}
          to="/api-docs"
          color="text.secondary"
          sx={{ fontSize: 13, fontWeight: 700 }}
        >
          API
        </Typography>
      </Stack>
    </Stack>
  );
}

function PrivacyPolicyLink() {
  return (
    <Box
      component={Link}
      to="/privacy"
      sx={{
        color: "inherit",
        fontWeight: 750,
        textDecoration: "underline",
        textUnderlineOffset: "3px",
      }}
    >
      Privacy Policy
    </Box>
  );
}

const FAQS: ReadonlyArray<{ question: string; answer: ReactNode }> = [
  {
    question: "Do I need an account?",
    answer:
      "No. The calculator works for every visitor without signing in. An account is only needed if you want a shared Seisan project.",
  },
  {
    question: "Is my calculator data uploaded to the server?",
    answer: (
      <>
        No. Names, payment amounts, and split settings entered in this calculator are never uploaded
        to Seisan&apos;s servers, and the settlement calculation is performed locally in your
        browser. Your draft is saved only in this browser&apos;s local storage. It is not
        synchronized to another browser or device, and you can clear it from the calculator. This
        applies only to this public calculator. See our <PrivacyPolicyLink /> for how Seisan
        projects handle data.
      </>
    ),
  },
  {
    question: "Can I split an expense unequally?",
    answer:
      "Yes. Ratio mode accepts positive decimal weights, and Custom mode accepts an exact non-negative dollar share for every member.",
  },
  {
    question: "Can I enter multiple expenses?",
    answer:
      "This calculator handles one aggregate total. Combine what each person paid and what each person should owe before calculating. To enter multiple expenses individually, create a shared Seisan project and record each expense as it happens.",
  },
  {
    question: "How is the settlement plan calculated?",
    answer:
      "The calculator compares each member's paid amount with their share, then deterministically matches people who owe money with people who are owed money.",
  },
];

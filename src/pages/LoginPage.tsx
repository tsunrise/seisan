import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { pageCenterSx, panelFrameSx } from "../components/styles";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnTo = searchParams.get("returnTo") ?? "/projects";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (step === "email") {
        await api.requestLoginCode(email);
        setStep("code");
        return;
      }
      await api.verifyLoginCode(email, code);
      navigate(returnTo, { replace: true });
    } catch {
      setError(step === "email" ? "Unable to send a code." : "That code did not work.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box component="main" sx={pageCenterSx}>
      <Paper
        component="form"
        square
        onSubmit={submit}
        sx={{ ...panelFrameSx, width: "min(100%, 380px)" }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography
              sx={{
                color: "text.secondary",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Seisan
            </Typography>
            <Typography variant="h1">{step === "email" ? "Sign in" : "Enter code"}</Typography>
          </Box>
          <Typography color="text.secondary">
            {step === "email"
              ? "Use the email address allowed for this workspace."
              : `We sent a six digit code to ${email}.`}
          </Typography>
          {step === "email" ? (
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          ) : (
            <TextField
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              slotProps={{
                htmlInput: {
                  pattern: "\\d{6}",
                  maxLength: 6,
                },
              }}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
              required
              sx={{
                "& input": {
                  fontSize: 24,
                  letterSpacing: 8,
                  textAlign: "center",
                },
              }}
            />
          )}
          {error ? <InlineAlert>{error}</InlineAlert> : null}
          <Button
            type="submit"
            variant="contained"
            disabled={submitting}
            sx={{ alignSelf: "start" }}
          >
            {step === "email" ? "Send code" : "Verify"}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

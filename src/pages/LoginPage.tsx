import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import type { FormEvent } from "react";
import { useCallback, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import * as api from "../api";
import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { pageCenterSx, panelFrameSx } from "../components/styles";
import { Turnstile } from "../components/Turnstile";
import { getLoginTurnstileSiteKey, shouldUseLoginTurnstile } from "../turnstile";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [step, setStep] = useState<"email" | "code">("email");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnTo = searchParams.get("returnTo") ?? "/projects";
  const requiresTurnstile = shouldUseLoginTurnstile();
  const turnstileSiteKey = getLoginTurnstileSiteKey();

  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileResetKey((key) => key + 1);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setError("Verification failed. Please try again.");
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (step === "email") {
        if (requiresTurnstile && !turnstileToken) {
          setError("Complete the verification first.");
          return;
        }
        const attempt = await api.requestLoginCode(email, turnstileToken ?? undefined);
        if (!attempt.id) {
          setError("A code was requested recently. Try again later.");
          resetTurnstile();
          return;
        }
        setAttemptId(attempt.id);
        setStep("code");
        return;
      }
      if (!attemptId) {
        setError("Request a new code first.");
        return;
      }
      await api.verifyLoginCode(attemptId, email, code);
      navigate(returnTo, { replace: true });
    } catch {
      setError(step === "email" ? "Unable to send a code." : "That code did not work.");
      if (step === "email") {
        resetTurnstile();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box component="main" sx={pageCenterSx}>
      <Stack spacing={1.5} sx={{ width: "min(100%, 380px)" }}>
        <Paper component="form" square onSubmit={submit} sx={panelFrameSx}>
          <Stack spacing={2}>
            <Box>
              <BrandLink sx={{ mb: 1 }} />
              <Typography variant="h1">
                {step === "email" ? "Get Started" : "Enter code"}
              </Typography>
            </Box>
            <Typography color="text.secondary">
              {step === "email"
                ? "Sign in or create your account."
                : `We sent a six digit code to ${email}.`}
            </Typography>
            {step === "email" ? (
              <>
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                {requiresTurnstile ? (
                  <Turnstile
                    siteKey={turnstileSiteKey}
                    resetKey={turnstileResetKey}
                    onToken={setTurnstileToken}
                    onError={handleTurnstileError}
                  />
                ) : null}
              </>
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
              disabled={submitting || (step === "email" && requiresTurnstile && !turnstileToken)}
              sx={{ alignSelf: "start" }}
            >
              {step === "email" ? "Continue" : "Verify"}
            </Button>
          </Stack>
        </Paper>
        <Paper square sx={{ ...panelFrameSx, p: 2 }}>
          <Typography sx={{ fontWeight: 750 }}>Split expenses with anyone.</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 14 }}>
            Seisan is a free tool for shared trips, meals, and everyday group spending.
          </Typography>
        </Paper>
      </Stack>
    </Box>
  );
}

import { Box } from "@mui/material";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "auto" | "light" | "dark";
          size?: "normal" | "flexible" | "compact";
          action?: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ): string;
      remove(widgetId: string): void;
    };
    __seisanTurnstileLoaded?: () => void;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;
const TURNSTILE_ONLOAD_CALLBACK = "__seisanTurnstileLoaded";

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (existingScript && !existingScript.src.includes(`onload=${TURNSTILE_ONLOAD_CALLBACK}`)) {
      existingScript.remove();
    } else if (existingScript) {
      window[TURNSTILE_ONLOAD_CALLBACK] = () => resolve();
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Turnstile failed to load")),
        {
          once: true,
        },
      );
      return;
    }

    window[TURNSTILE_ONLOAD_CALLBACK] = () => resolve();
    const script = document.createElement("script");
    script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${TURNSTILE_ONLOAD_CALLBACK}`;
    script.async = true;
    script.defer = true;
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), {
      once: true,
    });
    document.head.append(script);
  });

  return turnstileScriptPromise;
}

interface TurnstileProps {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: () => void;
}

export function Turnstile({ siteKey, resetKey, onToken, onError }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let widgetId: string | null = null;
    onToken(null);

    void loadTurnstileScript()
      .then(() => {
        if (!mounted || !containerRef.current || !window.turnstile) {
          return;
        }
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "light",
          size: "flexible",
          action: "login",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            onToken(null);
            onError();
          },
        });
      })
      .catch(() => {
        if (mounted) {
          onError();
        }
      });

    return () => {
      mounted = false;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [onError, onToken, resetKey, siteKey]);

  return (
    <Box
      ref={containerRef}
      sx={{
        minHeight: 65,
        width: "100%",
        "& iframe": {
          maxWidth: "100%",
        },
      }}
    />
  );
}

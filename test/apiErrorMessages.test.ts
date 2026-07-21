import { describe, expect, it } from "vitest";

import { ApiError } from "../src/apiError";
import { getApiErrorMessage } from "../src/apiErrorMessages";

describe("API error messages", () => {
  it("uses the generic blocked-email message when no reason is provided", () => {
    expect(
      getApiErrorMessage(new ApiError(403, JSON.stringify({ error: "email_not_supported" }))),
    ).toBe("This email is not supported.");
  });

  it("appends a blocked-email reason to the generic message", () => {
    expect(
      getApiErrorMessage(
        new ApiError(
          403,
          JSON.stringify({
            error: "email_not_supported",
            reason: "Please use your organization email.",
          }),
        ),
      ),
    ).toBe("This email is not supported. Please use your organization email.");
  });

  it("does not append an empty or whitespace-only blocked-email reason", () => {
    expect(
      getApiErrorMessage(
        new ApiError(403, JSON.stringify({ error: "email_not_supported", reason: "" })),
      ),
    ).toBe("This email is not supported.");
    expect(
      getApiErrorMessage(
        new ApiError(403, JSON.stringify({ error: "email_not_supported", reason: "   " })),
      ),
    ).toBe("This email is not supported.");
  });
});

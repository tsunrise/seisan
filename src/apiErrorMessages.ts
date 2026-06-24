import { ApiError } from "./api";

const unknownApiErrorMessage = "Something went wrong. Try again later.";
const networkErrorMessage = "Could not reach Seisan. Check your connection and try again.";

const defaultApiErrorMessages: Record<string, string> = {
  unauthorized: "Please sign in again.",
  forbidden: "You do not have access to do that.",
  not_found: "That item could not be found.",
  invalid_request: "Check the details and try again.",
  conflict: "That change conflicts with the current state.",
  already_linked: "That member is already linked to an email.",
  already_deleted: "That member has already been deleted.",
  nonzero_balance: "Only zero-balance members can be deleted.",
  project_limit_exceeded: "Project limit reached.",
  member_limit_exceeded: "Member limit reached. ",
  record_limit_exceeded: "This project has reached the record limit.",
  acl_limit_exceeded: "This project has reached the allowed-email limit.",
  money_limit_exceeded: "That amount is over the supported limit.",
  rate_limited: "You have been rate limited.",
  "rate_limited:account": "Your account is posting too many records in a short time. Try again later.",
  "rate_limited:project": "This project is receiving too many posts in a short time. Try again later.",
  internal_server_error: "Something went wrong on the server. Try again later.",
};

export function getApiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return networkErrorMessage;
  }

  const keyedCode = apiErrorMessageKey(error);
  if (keyedCode && defaultApiErrorMessages[keyedCode]) {
    return defaultApiErrorMessages[keyedCode];
  }
  if (error.code && defaultApiErrorMessages[error.code]) {
    return defaultApiErrorMessages[error.code];
  }
  return unknownApiErrorMessage;
}

function apiErrorMessageKey(error: ApiError): string | null {
  if (error.code === "rate_limited" && error.reason) {
    return `${error.code}:${error.reason}`;
  }
  return null;
}

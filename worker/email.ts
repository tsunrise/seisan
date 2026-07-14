import { z } from "zod";

export const MAX_EMAIL_LENGTH = 255;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const normalizedEmailSchema = z.email().max(MAX_EMAIL_LENGTH).transform(normalizeEmail);

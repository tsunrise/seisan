import { z } from "zod";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const normalizedEmailSchema = z.email().transform(normalizeEmail);

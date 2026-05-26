export function buildLoginEmail(input: { code: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Your Seisan login code",
    text: `Your Seisan login code is ${input.code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your Seisan login code is <strong>${input.code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  };
}

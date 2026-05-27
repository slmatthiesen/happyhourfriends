/**
 * hCaptcha server-side verification (PRD §5.1.2). When HCAPTCHA_SECRET_KEY is unset
 * in development, verification is skipped so the submission flow is testable without
 * captcha keys. In production an unset secret FAILS CLOSED — a self-hoster who deploys
 * without configuring captcha gets a blocked endpoint, not an open one.
 */
export async function verifyCaptcha(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<boolean> {
  const secret = process.env.HCAPTCHA_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("HCAPTCHA_SECRET_KEY is unset in production — rejecting submission.");
      return false; // fail closed
    }
    return true; // dev only → allow
  }
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://api.hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch {
    return false;
  }
}

/** True when captcha is actively enforced (secret present). */
export function isCaptchaEnforced(): boolean {
  return Boolean(process.env.HCAPTCHA_SECRET_KEY);
}

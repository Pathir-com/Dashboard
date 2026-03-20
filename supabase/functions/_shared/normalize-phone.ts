/** Normalize a UK phone number to E.164 format (+44...) */
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, "").trim();
  if (p.startsWith("0") && p.length >= 10) p = "+44" + p.slice(1);
  if (p.match(/^44\d{9,}$/) && !p.startsWith("+")) p = "+" + p;
  return p;
}

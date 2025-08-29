export function redactPII(input: string): string {
  let out = input;
  // Emails
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]");
  // Phone numbers (very rough: sequences of 10-15 digits, allowing separators)
  out = out.replace(/(?<!\d)(?:\+?\d[\s-]?){9,15}\d(?!\d)/g, "[redacted-phone]");
  return out;
}

/** Provider diagnostics stay local display text. Preserve the response body
 * (JSON, plain text or HTML), but remove credentials before it reaches React.
 */
export function providerErrorDetails(body: string, headers?: Headers, secret?: string): string {
  let details = body.trim();
  try {
    details = JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    // Gateways can return a plain-text or HTML 503 instead of JSON.
  }
  const requestId =
    headers?.get("x-request-id") || headers?.get("request-id") || headers?.get("cf-ray");
  if (requestId && !details.includes(requestId))
    details += `${details ? "\n" : ""}request_id: ${requestId}`;
  if (secret) {
    details = details.split(secret).join("[redacted]");
    const encoded = JSON.stringify(secret).slice(1, -1);
    if (encoded !== secret) details = details.split(encoded).join("[redacted]");
  }
  details = details
    .replace(
      /("(?:api[_-]?key|authorization|access[_-]?token|password|token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[redacted]"',
    )
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=\r\n]+/g, "[image data]");
  // Bound the diagnostic display without the old 400-character truncation.
  const characters = Array.from(details);
  return characters.slice(0, 16384).join("") + (characters.length > 16384 ? "\n…" : "");
}

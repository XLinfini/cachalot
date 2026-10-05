import type { OcrHttpInput, OcrJsonResponse } from "../../domain/ocr-adapter";
import type { Provider } from "../../domain/records";
import { message } from "../../domain/messages";
import { prepareOcrRequest, redactOcrJson } from "../../domain/ocr-http";
import { browserProviderKeys } from "../browser-provider-keys";
import { providerErrorDetails } from "../provider-error";

export async function browserOcrJson(
  provider: Provider,
  input: OcrHttpInput,
  signal?: AbortSignal,
): Promise<OcrJsonResponse> {
  const secret = input.auth?.type === "none" ? null : await browserProviderKeys.get(provider.id);
  const request = prepareOcrRequest(provider.baseUrl, input, secret || undefined);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
    redirect: "error",
  });
  const text = await response.text();
  const details = providerErrorDetails(text, response.headers, secret || undefined);
  if (!response.ok)
    throw new Error(message("ocrHttpDetails", { status: response.status, details }));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(message("ocrResponseError", { details }));
  }
  return { body: redactOcrJson(body, secret || undefined), details };
}

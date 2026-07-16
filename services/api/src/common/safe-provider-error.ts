const PROVIDER_ERROR_CODES = [
  "google_rate_limited",
  "google_invalid_grant",
  "ics_timeout",
  "ics_invalid_response",
  "provider_unavailable",
] as const;

export type SafeProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const PROVIDER_ERROR_CODE_SET = new Set<string>(PROVIDER_ERROR_CODES);
const SAFE_PROVIDER_MESSAGE = "External provider request failed";

export class SafeProviderError extends Error {
  readonly code: SafeProviderErrorCode;

  constructor(code: SafeProviderErrorCode) {
    super(SAFE_PROVIDER_MESSAGE);
    this.name = "SafeProviderError";
    this.code = code;
  }
}

export function toSafeProviderError(
  code: SafeProviderErrorCode,
  _providerError: unknown
): SafeProviderError {
  const safeCode = PROVIDER_ERROR_CODE_SET.has(code)
    ? code
    : "provider_unavailable";
  return new SafeProviderError(safeCode);
}

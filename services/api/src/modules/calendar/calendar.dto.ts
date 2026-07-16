import { Equals, IsBoolean } from "class-validator";

export class ConnectCalendarDto {
  @Equals(undefined)
  readonly _requestContract?: never;
}

export class UpdateCalendarSourceDto {
  @IsBoolean()
  readonly selected!: boolean;
}

export type AuthenticatedCalendarRequest = { user: { userId: string } };

export type GoogleOAuthCallbackInput =
  | { state: string; code: string; error?: never }
  | { state: string; error: string; code?: never };

export type CalendarConnectionSummary = {
  id: string;
  status: string;
  grantedScopes: string[];
  lastSyncedAt: Date | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function parseGoogleOAuthCallbackQuery(
  query: unknown
): GoogleOAuthCallbackInput {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw callbackError();
  }
  const input = query as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const isCode = keys.length === 2 && keys[0] === "code" && keys[1] === "state";
  const isError =
    keys.length === 2 && keys[0] === "error" && keys[1] === "state";
  if (!isCode && !isError) throw callbackError();
  if (!isScalar(input.state)) throw callbackError();
  if (isCode) {
    if (!isScalar(input.code)) throw callbackError();
    return { state: input.state, code: input.code };
  }
  if (!isScalar(input.error)) throw callbackError();
  return { state: input.state, error: input.error };
}

function isScalar(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function callbackError(): Error {
  return new Error("Invalid OAuth callback");
}

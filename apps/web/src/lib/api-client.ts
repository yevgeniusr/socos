import { authFetch } from "@/lib/auth";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return fallback;
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const messages = message.filter(
      (item): item is string => typeof item === "string"
    );
    if (messages.length) return messages.join(", ");
  }
  return fallback;
}

export async function apiJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authFetch(path, options);
  const contentType = response.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiError(
      errorMessage(body, `Request failed with status ${response.status}`),
      response.status
    );
  }

  return body as T;
}

import { NextResponse, type NextRequest } from "next/server";

const API_BASE = (
  process.env.API_INTERNAL_URL || "http://localhost:3001"
).replace(/\/$/, "");
const HEADER_FILTER = ["host", "connection", "content-length"];
const BODYLESS_STATUSES = new Set([204, 205, 304]);
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function proxyRequest(
  request: NextRequest,
  params: Promise<{ catchall: string[] }>
) {
  const { catchall } = await params;
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!HEADER_FILTER.includes(key.toLowerCase())) headers[key] = value;
  });

  try {
    const body = METHODS_WITH_BODY.has(request.method)
      ? await request.text()
      : undefined;
    const response = await fetch(
      `${API_BASE}/api/${catchall.join("/")}${url.search}`,
      {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
        credentials: "include",
      }
    );
    const responseBody = BODYLESS_STATUSES.has(response.status)
      ? null
      : await response.text();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
}

type RouteContext = { params: Promise<{ catchall: string[] }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, params);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, params);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, params);
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, params);
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, params);
}

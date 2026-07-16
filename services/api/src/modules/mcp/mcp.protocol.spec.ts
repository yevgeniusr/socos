import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentPrincipal } from "@socos/agent-core";
import { z } from "zod";
import { AgentAuthGuard } from "../agent-auth/agent-auth.guard.js";
import { AgentAuthService } from "../agent-auth/agent-auth.service.js";
import { AgentToolRegistryService } from "../agent-tools/tool-registry.service.js";
import { McpController } from "./mcp.controller.js";
import { McpRequestPolicy } from "./mcp-request-policy.js";
import { McpServerFactory } from "./mcp-server.factory.js";

const principals: Record<string, AgentPrincipal> = {
  "credential-a": {
    ownerId: "owner-a",
    clientId: "client-a",
    credentialId: "credential-a",
    clientName: "Hermes A",
    scopes: ["contacts:read"],
  },
  "credential-b": {
    ownerId: "owner-b",
    clientId: "client-b",
    credentialId: "credential-b",
    clientName: "Hermes B",
    scopes: ["contacts:read"],
  },
};

describe("MCP Streamable HTTP protocol", () => {
  let app: INestApplication;
  let endpoint: URL;
  let factory: McpServerFactory;
  const registry = {
    definitions: jest.fn().mockReturnValue([
      {
        metadata: {
          name: "socos_contacts_search",
          description: "Search owner contacts",
          requiredScope: "contacts:read",
          risk: "read",
          requiresIdempotencyKey: false,
        },
        inputSchema: z.strictObject({ query: z.string().min(1).max(100) }),
      },
    ]),
    call: jest.fn().mockImplementation((name, principal, input) =>
      Promise.resolve({
        ok: true,
        data: { name, clientId: principal.clientId, query: input.query },
      })
    ),
  };
  const auth = {
    authenticate: jest.fn().mockImplementation((token: string) => {
      const principal = principals[token];
      if (!principal) throw new UnauthorizedException("private auth detail");
      return Promise.resolve(principal);
    }),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.MCP_ALLOWED_HOSTS;
    delete process.env.MCP_ALLOWED_ORIGINS;
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        McpRequestPolicy,
        McpServerFactory,
        AgentAuthGuard,
        { provide: AgentAuthService, useValue: auth },
        { provide: AgentToolRegistryService, useValue: registry },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    endpoint = new URL(`http://127.0.0.1:${address.port}/api/mcp`);
    factory = moduleRef.get(McpServerFactory);
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  function client(token: string) {
    const protocol = new Client({ name: "socos-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    return { protocol, transport };
  }

  async function step<T>(label: string, operation: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Timed out: ${label}`)),
            2000
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  it("initializes and performs tools/list and tools/call through official clients", async () => {
    const createSpy = jest.spyOn(factory, "create");
    const { protocol, transport } = client("credential-a");

    await step("connect", protocol.connect(transport));
    const listed = await step("list", protocol.listTools());
    const called = await step(
      "call",
      protocol.callTool({
        name: "socos_contacts_search",
        arguments: { query: "Synthetic" },
      })
    );
    await protocol.close();

    expect(listed.tools).toEqual([
      expect.objectContaining({
        name: "socos_contacts_search",
        description: "Search owner contacts",
      }),
    ]);
    expect(JSON.parse((called.content[0] as { text: string }).text)).toEqual({
      ok: true,
      data: {
        name: "socos_contacts_search",
        clientId: "client-a",
        query: "Synthetic",
      },
    });
    expect(createSpy.mock.results.length).toBeGreaterThanOrEqual(3);
    const runtimes = createSpy.mock.results.map((result) => result.value);
    expect(new Set(runtimes.map((runtime) => runtime.server)).size).toBe(
      runtimes.length
    );
    expect(new Set(runtimes.map((runtime) => runtime.transport)).size).toBe(
      runtimes.length
    );
  });

  it("rejects missing and invalid bearer credentials generically", async () => {
    const missing = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(missing.status).toBe(401);
    expect(await missing.text()).not.toContain("private auth detail");

    const { protocol, transport } = client("invalid-credential");
    await expect(protocol.connect(transport)).rejects.toMatchObject({
      code: 401,
    });
  });

  it("fails closed for malformed and unknown protocol calls", async () => {
    const malformed = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer credential-a",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: 42 }),
    });
    expect(malformed.status).toBe(400);

    const { protocol, transport } = client("credential-a");
    await protocol.connect(transport);
    await expect(
      protocol.callTool({ name: "socos_unknown", arguments: {} })
    ).resolves.toEqual(
      expect.objectContaining({
        isError: true,
        content: [
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("Tool socos_unknown not found"),
          }),
        ],
      })
    );
    await protocol.close();
  });

  it("isolates parallel stateless clients by their server-resolved principals", async () => {
    const first = client("credential-a");
    const second = client("credential-b");
    await Promise.all([
      first.protocol.connect(first.transport),
      second.protocol.connect(second.transport),
    ]);

    const [left, right] = await Promise.all([
      first.protocol.callTool({
        name: "socos_contacts_search",
        arguments: { query: "Same" },
      }),
      second.protocol.callTool({
        name: "socos_contacts_search",
        arguments: { query: "Same" },
      }),
    ]);
    await Promise.all([first.protocol.close(), second.protocol.close()]);

    expect(
      JSON.parse((left.content[0] as { text: string }).text).data.clientId
    ).toBe("client-a");
    expect(
      JSON.parse((right.content[0] as { text: string }).text).data.clientId
    ).toBe("client-b");
  });

  it("enforces POST, JSON content, and origin policy", async () => {
    const get = await fetch(endpoint, {
      headers: { authorization: "Bearer credential-a" },
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    const text = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer credential-a",
        "content-type": "text/plain",
      },
      body: "{}",
    });
    expect(text.status).toBe(415);

    const origin = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer credential-a",
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(origin.status).toBe(403);
  });
});

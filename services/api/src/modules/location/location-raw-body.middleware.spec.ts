import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import { configureLocationBodyParsers } from "./location-raw-body.middleware.js";

type RawResponse = { status: number; body: string };

describe("configureLocationBodyParsers", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const app = express();
    configureLocationBodyParsers(app);
    app.post("/api/location/owntracks", (_request, response) => {
      response.status(200).json([]);
    });
    app.post("/api/existing", (request, response) => {
      response
        .status(200)
        .json({ accepted: typeof request.body?.value === "string" });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("accepts a valid OwnTracks JSON body of exactly 8,192 raw bytes", async () => {
    const body = sizedJson(8_192);

    const response = await postRaw(port, "/api/location/owntracks", body);

    expect(Buffer.byteLength(body)).toBe(8_192);
    expect(response).toEqual({ status: 200, body: "[]" });
  });

  it("rejects an OwnTracks JSON body of 8,193 raw bytes with a sanitized 413", async () => {
    const body = sizedJson(8_193);

    const response = await postRaw(port, "/api/location/owntracks", body);

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      statusCode: 413,
      code: "payload_too_large",
      message: "Payload too large",
    });
    expect(response.body).not.toContain("location");
  });

  it("rejects malformed OwnTracks JSON with a sanitized 400", async () => {
    const response = await postRaw(
      port,
      "/api/location/owntracks",
      '{"_type":"location","lat":'
    );

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      statusCode: 400,
      code: "invalid_json",
      message: "Invalid JSON",
    });
    expect(response.body).not.toContain("location");
  });

  it("keeps the general JSON parser available to existing routes", async () => {
    const body = JSON.stringify({ value: "x".repeat(9_000) });

    const response = await postRaw(port, "/api/existing", body);

    expect(response).toEqual({ status: 200, body: '{"accepted":true}' });
  });
});

describe("application parser wiring", () => {
  it("disables the Nest parser and installs location parsers before route setup", () => {
    const source = readFileSync(join(__dirname, "..", "..", "main.ts"), "utf8");
    const createAt = source.search(
      /NestFactory\.create\(\s*AppModule,\s*\{\s*bodyParser:\s*false\s*\}\s*\)/
    );
    const configureAt = source.search(
      /configureLocationBodyParsers\(\s*app\.getHttpAdapter\(\)\.getInstance\(\)\s*\)/
    );
    const prefixAt = source.search(/app\.setGlobalPrefix\(["']api["']\)/);

    expect(createAt).toBeGreaterThan(-1);
    expect(configureAt).toBeGreaterThan(createAt);
    expect(prefixAt).toBeGreaterThan(configureAt);
  });
});

function sizedJson(bytes: number): string {
  const prefix = '{"_type":"location","tst":1,"lat":0,"lon":0';
  const suffix = "}";
  return `${prefix}${" ".repeat(bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
}

function postRaw(
  port: number,
  path: string,
  body: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}

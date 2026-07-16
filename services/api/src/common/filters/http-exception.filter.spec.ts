import { ArgumentsHost, NotFoundException } from "@nestjs/common";
import { AllExceptionsFilter } from "./http-exception.filter.js";

describe("AllExceptionsFilter", () => {
  it("preserves a structured public error code for agent clients", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: "GET",
          url: "/api/briefs/today",
          headers: {},
        }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new NotFoundException({
        code: "BRIEF_NOT_READY",
        message: "Today's brief is not ready.",
      }),
      host
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: "BRIEF_NOT_READY",
        message: "Today's brief is not ready.",
        path: "/api/briefs/today",
      })
    );
  });

  it("does not reflect non-string code values", () => {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ method: "GET", url: "/api/test", headers: {} }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new NotFoundException({ code: { private: true }, message: "Missing" }),
      host
    );

    expect(json.mock.calls[0][0]).not.toHaveProperty("code");
  });
});

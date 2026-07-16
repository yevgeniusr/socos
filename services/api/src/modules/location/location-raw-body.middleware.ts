import express, { type ErrorRequestHandler, type Express } from "express";

const OWNTRACKS_PATH = "/api/location/owntracks";
const OWNTRACKS_BODY_LIMIT_BYTES = 8_192;

export function configureLocationBodyParsers(app: Express): void {
  app.use(
    OWNTRACKS_PATH,
    express.json({
      limit: OWNTRACKS_BODY_LIMIT_BYTES,
      type: "application/json",
    }),
    ownTracksJsonErrorHandler
  );
  app.use(express.json());
}

const ownTracksJsonErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next
) => {
  const parserError = error as { status?: unknown; type?: unknown };
  if (parserError.status === 413 && parserError.type === "entity.too.large") {
    response.status(413).json({
      statusCode: 413,
      code: "payload_too_large",
      message: "Payload too large",
    });
    return;
  }
  if (
    parserError.status === 400 &&
    parserError.type === "entity.parse.failed"
  ) {
    response.status(400).json({
      statusCode: 400,
      code: "invalid_json",
      message: "Invalid JSON",
    });
    return;
  }
  next(error);
};

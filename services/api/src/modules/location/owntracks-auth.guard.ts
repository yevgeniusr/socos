import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { DeviceCredentialService } from "../personal-data/device-credential.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PrismaService } from "../prisma/prisma.service.js";

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const PASSWORD_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class OwnTracksAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PersonalDataConfigService,
    private readonly credentials: DeviceCredentialService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.config.requireEnabled("locationIngest");
    const request = context.switchToHttp().getRequest();
    const parsed = parseBasicCredentials(request.headers?.authorization);
    if (!parsed) throw unauthorized();

    const device = await this.prisma.locationDevice.findUnique({
      where: { username: parsed.username },
      select: { id: true, ownerId: true, credentialHash: true, status: true },
    });
    if (!device || device.status !== "active") throw unauthorized();

    const valid = await this.credentials.verify(
      parsed.password,
      device.credentialHash
    );
    if (!valid) throw unauthorized();

    request.locationDevice = { id: device.id, ownerId: device.ownerId };
    return true;
  }
}

function parseBasicCredentials(
  authorization: unknown
): { username: string; password: string } | undefined {
  if (typeof authorization !== "string") return undefined;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return undefined;

  const encoded = match[1];
  const decoded = Buffer.from(encoded, "base64");
  if (
    decoded.length === 0 ||
    decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
  ) {
    return undefined;
  }
  const value = decoded.toString("utf8");
  if (Buffer.from(value, "utf8").compare(decoded) !== 0) return undefined;
  const separator = value.indexOf(":");
  if (separator < 0) return undefined;

  const username = value.slice(0, separator);
  const password = value.slice(separator + 1);
  if (!USERNAME_PATTERN.test(username) || !PASSWORD_PATTERN.test(password)) {
    return undefined;
  }
  return { username, password };
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: "invalid_device_credentials",
    message: "Unauthorized",
  });
}

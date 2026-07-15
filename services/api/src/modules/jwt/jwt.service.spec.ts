import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwtService } from './jwt.service.js';

const PRIMARY_SECRET = 'synthetic-primary-secret-32-chars';
const SECONDARY_SECRET = 'synthetic-secondary-secret-32-ch';

function createConfig(secret?: string): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return secret;
      if (key === 'NODE_ENV') return 'production';
      return undefined;
    }),
  } as unknown as ConfigService;
}

function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  const encodedPayload = parts.length === 3 ? parts[1] : token;
  return JSON.parse(Buffer.from(encodedPayload, parts.length === 3 ? 'base64url' : 'base64').toString('utf8'));
}

function modifyOnePayloadByte(token: string): string {
  const parts = token.split('.');
  const payloadIndex = parts.length === 3 ? 1 : 0;
  const encoding = parts.length === 3 ? 'base64url' : 'base64';
  const payload = Buffer.from(parts[payloadIndex], encoding);
  const marker = Buffer.from('synthetic-user-a');
  const markerIndex = payload.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);
  payload[markerIndex + marker.length - 1] = 'b'.charCodeAt(0);
  parts[payloadIndex] = payload.toString(encoding);
  return parts.join('.');
}

describe('JwtService', () => {
  it('generates and verifies a signed token with the required claims', () => {
    const service = new JwtService(createConfig(PRIMARY_SECRET));

    const token = service.generateToken('synthetic-user-a');
    const payload = decodePayload(token);
    const verified = service.verifyToken(token);

    expect(token.split('.')).toHaveLength(3);
    expect(payload).toMatchObject({
      sub: 'synthetic-user-a',
      iss: 'socos-api',
      aud: 'socos-clients',
    });
    expect(verified).toEqual({
      userId: 'synthetic-user-a',
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
    expect(verified!.exp - verified!.iat).toBe(7 * 24 * 60 * 60);
  });

  it('rejects a token after a one-byte payload modification', () => {
    const service = new JwtService(createConfig(PRIMARY_SECRET));
    const token = service.generateToken('synthetic-user-a');

    const forgedToken = modifyOnePayloadByte(token);

    expect(service.verifyToken(forgedToken)).toBeNull();
  });

  it('rejects an expired token', () => {
    const service = new JwtService(createConfig(PRIMARY_SECRET));
    const expiredToken = jwt.sign({}, PRIMARY_SECRET, {
      algorithm: 'HS256',
      subject: 'synthetic-user-a',
      expiresIn: -1,
      issuer: 'socos-api',
      audience: 'socos-clients',
    });

    expect(service.verifyToken(expiredToken)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const issuer = new JwtService(createConfig(PRIMARY_SECRET));
    const verifier = new JwtService(createConfig(SECONDARY_SECRET));

    expect(verifier.verifyToken(issuer.generateToken('synthetic-user-a'))).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['short', 'synthetic-short-secret'],
  ])('rejects a %s JWT secret in production', (_label, secret) => {
    expect(() => new JwtService(createConfig(secret))).toThrow('JWT_SECRET');
  });
});

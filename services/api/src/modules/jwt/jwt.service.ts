import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

const JWT_ISSUER = 'socos-api';
const JWT_AUDIENCE = 'socos-clients';
const MINIMUM_SECRET_LENGTH = 32;

@Injectable()
export class JwtService {
  private readonly secret: string;

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters`);
    }

    this.secret = secret;
  }

  generateToken(userId: string): string {
    return jwt.sign({}, this.secret, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: '7d',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  verifyToken(token: string): { userId: string; iat: number; exp: number } | null {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      if (
        typeof decoded === 'string'
        || typeof decoded.sub !== 'string'
        || typeof decoded.iat !== 'number'
        || typeof decoded.exp !== 'number'
      ) {
        return null;
      }

      return {
        userId: decoded.sub,
        iat: decoded.iat,
        exp: decoded.exp,
      };
    } catch {
      return null;
    }
  }
}

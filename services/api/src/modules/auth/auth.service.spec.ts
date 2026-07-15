import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '../jwt/jwt.service.js';
import { AuthService } from './auth.service.js';

const LEGACY_BYPASS_EMAIL = ['yev.rachkovan', 'gmail.com'].join('@');
const LEGACY_BYPASS_PASSWORD = ['socos', '2026'].join('');
const LEGACY_DEFAULT_INVITE = ['socos-founding', '2026'].join('-');
const CONFIGURED_INVITE = 'synthetic-configured-invite';

const user = {
  id: 'synthetic-user-id',
  email: LEGACY_BYPASS_EMAIL,
  name: 'Synthetic User',
  passwordHash: '$2a$10$eImiTXuWVxfM37uY4JANjQ==',
  xp: 10,
  level: 1,
  vaults: [{ id: 'synthetic-vault-id' }],
};

const prismaUser = {
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const prisma = { user: prismaUser } as unknown as PrismaService;

const generateToken = jest.fn().mockReturnValue('synthetic-access-token');
const jwtService = { generateToken } as unknown as JwtService;

describe('AuthService security', () => {
  let service: AuthService;
  const originalInviteCodes = process.env.INVITE_CODES;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.INVITE_CODES;
    service = new AuthService(prisma, jwtService);
  });

  afterAll(() => {
    if (originalInviteCodes === undefined) {
      delete process.env.INVITE_CODES;
    } else {
      process.env.INVITE_CODES = originalInviteCodes;
    }
  });

  it('rejects the removed account-specific credentials when the bcrypt hash does not match', async () => {
    const nonmatchingUser = {
      ...user,
      passwordHash: await bcrypt.hash('synthetic-different-password', 4),
    };
    prismaUser.findUnique.mockResolvedValue(nonmatchingUser);

    await expect(service.login({
      email: LEGACY_BYPASS_EMAIL,
      password: LEGACY_BYPASS_PASSWORD,
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it('fails registration closed when invite codes are not configured', async () => {
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue(user);
    prismaUser.update.mockResolvedValue(user);

    await expect(service.register({
      email: 'synthetic-new-user@example.test',
      password: 'synthetic-password',
      name: 'Synthetic New User',
      inviteCode: LEGACY_DEFAULT_INVITE,
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prismaUser.findUnique).not.toHaveBeenCalled();
    expect(prismaUser.create).not.toHaveBeenCalled();
  });

  it('registers only with an explicitly configured invite code', async () => {
    process.env.INVITE_CODES = CONFIGURED_INVITE;
    prismaUser.findUnique.mockResolvedValue(null);
    prismaUser.create.mockResolvedValue({
      ...user,
      email: 'synthetic-new-user@example.test',
    });
    prismaUser.update.mockResolvedValue(user);

    const result = await service.register({
      email: 'synthetic-new-user@example.test',
      password: 'synthetic-password',
      name: 'Synthetic New User',
      inviteCode: CONFIGURED_INVITE,
    });

    expect(result).toEqual({
      accessToken: 'synthetic-access-token',
      user: {
        id: 'synthetic-user-id',
        email: 'synthetic-new-user@example.test',
        name: 'Synthetic User',
        xp: 10,
        level: 1,
      },
    });
  });
});

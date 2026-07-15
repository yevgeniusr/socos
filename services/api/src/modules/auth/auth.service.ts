import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto, LoginDto, AuthResponseDto, UpdateProfileDto } from './auth.dto.js';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '../jwt/jwt.service.js';

function isValidInviteCode(code: string): boolean {
  const configuredCodes = process.env.INVITE_CODES;
  if (!configuredCodes) return false;

  const validCodes = configuredCodes
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);
  return validCodes.includes(code);
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // ── Invite-only check ─────────────────────────────────────────
    if (!isValidInviteCode(dto.inviteCode)) {
      throw new UnauthorizedException('Invalid or expired invite code. Request one from the account owner.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Create default vault for user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        vaults: {
          create: {
            name: 'My Contacts',
            description: 'Default vault for your contacts',
          },
        },
      },
      include: {
        vaults: true,
      },
    });

    const vault = user.vaults[0];

    // Update user with default vault
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        vaults: {
          connect: { id: vault.id },
        },
      },
    });

    const accessToken = this.jwtService.generateToken(user.id);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        xp: user.xp,
        level: user.level,
      },
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let isPasswordValid = false;
    try {
      isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    } catch {
      isPasswordValid = false;
    }

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwtService.generateToken(user.id);
    return { accessToken, user: { id: user.id, email: user.email, name: user.name, xp: user.xp, level: user.level } };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        xp: true,
        level: true,
        streakDays: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        xp: true,
        level: true,
      },
    });

    return user;
  }

  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            contacts: true,
            interactions: true,
            reminders: true,
            achievements: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const xpForNextLevel = user.level * 500;
    const xpProgress = user.xp % xpForNextLevel;

    return {
      xp: user.xp,
      level: user.level,
      xpToNextLevel: xpForNextLevel,
      xpProgress,
      streakDays: user.streakDays,
      contactsCount: user._count.contacts,
      interactionsCount: user._count.interactions,
      achievementsCount: user._count.achievements,
    };
  }
}

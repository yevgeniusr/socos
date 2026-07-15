import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { InteractionType } from '../interactions/interactions.dto.js';

@Injectable()
export class GamificationService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ── Streak Logic ──────────────────────────────────────────────────────

  /**
   * Record a daily check-in for the user.
   * Rules:
   * - First check-in ever → streak = 1
   * - Already checked in today → no change
   * - Checked in yesterday → streak + 1
   * - Missed 1+ days → streak reset to 1
   *
   * Awards bonus XP on milestone days.
   */
  async checkIn(userId: string): Promise<{
    streakDays: number;
    checkedInToday: boolean;
    streakBroken: boolean;
    xpAwarded: number;
    newAchievements: string[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { streakDays: true, lastActiveAt: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastActive = user.lastActiveAt
      ? new Date(
          user.lastActiveAt.getFullYear(),
          user.lastActiveAt.getMonth(),
          user.lastActiveAt.getDate(),
        )
      : null;

    // Already checked in today
    if (lastActive && lastActive.getTime() === today.getTime()) {
      return {
        streakDays: user.streakDays,
        checkedInToday: true,
        streakBroken: false,
        xpAwarded: 0,
        newAchievements: [],
      };
    }

    let newStreak = 1;
    let streakBroken = false;

    if (!lastActive) {
      newStreak = 1;
    } else if (lastActive.getTime() === yesterday.getTime()) {
      newStreak = user.streakDays + 1;
    } else if (lastActive.getTime() < yesterday.getTime()) {
      newStreak = 1;
      streakBroken = true;
    }

    // XP award: base 5, +20 for 7-day streak, +50 for 30-day streak
    let xpAwarded = 5;
    if (newStreak >= 30) xpAwarded += 50;
    else if (newStreak >= 7) xpAwarded += 20;
    else if (newStreak >= 3) xpAwarded += 10;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        streakDays: newStreak,
        lastActiveAt: now,
        xp: { increment: xpAwarded },
      },
    });

    // Check for streak achievements
    const newAchievements = await this.checkStreakAchievements(userId, newStreak);

    return {
      streakDays: newStreak,
      checkedInToday: true,
      streakBroken,
      xpAwarded,
      newAchievements,
    };
  }

  /**
   * Get current streak status for a user.
   */
  async getStreak(userId: string): Promise<{
    streakDays: number;
    lastActiveAt: Date | null;
    checkedInToday: boolean;
    checkedInYesterday: boolean;
    streakAtRisk: boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { streakDays: true, lastActiveAt: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastActive = user.lastActiveAt
      ? new Date(
          user.lastActiveAt.getFullYear(),
          user.lastActiveAt.getMonth(),
          user.lastActiveAt.getDate(),
        )
      : null;

    const checkedInToday = lastActive ? lastActive.getTime() === today.getTime() : false;
    const checkedInYesterday = lastActive ? lastActive.getTime() === yesterday.getTime() : false;
    const streakAtRisk = user.streakDays > 0 && !checkedInToday && !checkedInYesterday;

    return {
      streakDays: user.streakDays,
      lastActiveAt: user.lastActiveAt,
      checkedInToday,
      checkedInYesterday,
      streakAtRisk,
    };
  }

  /**
   * Check and award streak-based achievements.
   */
  private async checkStreakAchievements(userId: string, streakDays: number): Promise<string[]> {
    const newAchievements: string[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        achievements: {
          include: { achievement: true },
        },
      },
    });

    if (!user) return newAchievements;

    const existingCodes = user.achievements
      .map((ua) => ua.achievement?.code)
      .filter((code): code is string => !!code);

    const streakAchievements = [
      { code: 'streak_starter', name: 'Streak Starter', target: 3 },
      { code: 'streak_master', name: 'Streak Master', target: 7 },
      { code: 'streak_legend', name: 'Streak Legend', target: 30 },
    ];

    for (const achievement of streakAchievements) {
      if (existingCodes.includes(achievement.code)) continue;
      if (streakDays < achievement.target) continue;

      let dbAchievement = await this.prisma.achievement.findUnique({
        where: { code: achievement.code },
      });

      if (!dbAchievement) {
        dbAchievement = await this.prisma.achievement.create({
          data: {
            code: achievement.code,
            name: achievement.name,
            description: `Maintained a ${achievement.target}-day activity streak!`,
            xpReward: achievement.target * 25,
            requirement: JSON.stringify({ type: 'streak', target: achievement.target }),
          },
        });
      }

      await this.prisma.userAchievement.create({
        data: {
          userId,
          achievementId: dbAchievement.id,
        },
      });

      await this.prisma.user.update({
        where: { id: userId },
        data: { xp: { increment: dbAchievement.xpReward } },
      });

      // Send achievement notification
      this.notifications.sendGamificationAchievement(userId, {
        name: dbAchievement.name,
        description: dbAchievement.description,
        xpReward: dbAchievement.xpReward,
      }).catch((err) =>
        console.error('Failed to send achievement notification:', err),
      );

      newAchievements.push(dbAchievement.name);
    }

    return newAchievements;
  }

  // XP rewards for different interaction types
  private readonly XP_REWARDS: Record<string, number> = {
    [InteractionType.CALL]: 10,
    [InteractionType.MESSAGE]: 10,
    [InteractionType.MEETING]: 30,
    [InteractionType.NOTE]: 5,
    [InteractionType.EMAIL]: 10,
    [InteractionType.SOCIAL]: 15,
  };

  async calculateInteractionXp(type: string): Promise<number> {
    return this.XP_REWARDS[type] || 10;
  }

  async checkLevelUp(userId: string, totalXp: number): Promise<{ newLevel: number; xpForNextLevel: number; leveledUp: boolean; previousLevel: number }> {
    // Simple level formula: level = floor(sqrt(xp / 100)) + 1
    const newLevel = Math.floor(Math.sqrt(totalXp / 100)) + 1;
    const xpForNextLevel = Math.pow(newLevel, 2) * 100;

    // Get previous level to detect actual level-up
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { level: true },
    });
    const previousLevel = user?.level ?? 1;
    const leveledUp = newLevel > previousLevel;

    // Update user's level
    await this.prisma.user.update({
      where: { id: userId },
      data: { level: newLevel },
    });

    // Send level-up notification if user actually leveled up
    if (leveledUp) {
      const levelName = this.getLevelName(newLevel);
      this.notifications.sendGamificationLevelUp(userId, newLevel, levelName).catch((err) =>
        console.error('Failed to send level-up notification:', err),
      );
    }

    return { newLevel, xpForNextLevel, leveledUp, previousLevel };
  }

  async checkAchievements(userId: string): Promise<string[]> {
    const newAchievements: string[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            contacts: { where: { isDemo: false } },
            interactions: { where: { contact: { isDemo: false } } },
          },
        },
        achievements: {
          include: {
            achievement: true,
          },
        },
      },
    });

    if (!user) return newAchievements;

    // Get the achievement codes that user already has
    const existingAchievementCodes = user.achievements
      .map((ua) => ua.achievement?.code)
      .filter((code): code is string => !!code);

    // Define achievements
    const achievements = [
      { code: 'first_contact', name: 'First Contact', target: 1, type: 'contacts' },
      { code: 'social_butterfly', name: 'Social Butterfly', target: 10, type: 'contacts' },
      { code: 'networker', name: 'Networker', target: 50, type: 'contacts' },
      { code: 'first_interaction', name: 'First Interaction', target: 1, type: 'interactions' },
      { code: 'prolific', name: 'Prolific', target: 100, type: 'interactions' },
    ];

    for (const achievement of achievements) {
      if (existingAchievementCodes.includes(achievement.code)) continue;

      const count = user._count[achievement.type as keyof typeof user._count] || 0;
      
      if (count >= achievement.target) {
        // Create the achievement if it doesn't exist
        let dbAchievement = await this.prisma.achievement.findUnique({
          where: { code: achievement.code },
        });

        if (!dbAchievement) {
          dbAchievement = await this.prisma.achievement.create({
            data: {
              code: achievement.code,
              name: achievement.name,
              description: `You ${achievement.type === 'contacts' ? 'added' : 'logged'} ${achievement.target} ${achievement.type}!`,
              xpReward: achievement.target * 50,
              requirement: JSON.stringify({ type: 'count', target: achievement.target, object: achievement.type }),
            },
          });
        }

        // Unlock achievement for user
        await this.prisma.userAchievement.create({
          data: {
            userId,
            achievementId: dbAchievement.id,
          },
        });

        // Award XP
        await this.prisma.user.update({
          where: { id: userId },
          data: { xp: { increment: dbAchievement.xpReward } },
        });

        // Send achievement notification
        this.notifications.sendGamificationAchievement(userId, {
          name: dbAchievement.name,
          description: dbAchievement.description,
          xpReward: dbAchievement.xpReward,
        }).catch((err) =>
          console.error('Failed to send achievement notification:', err),
        );

        newAchievements.push(dbAchievement.name);
      }
    }

    return newAchievements;
  }

  async getUserAchievements(userId: string) {
    const achievements = await this.prisma.userAchievement.findMany({
      where: { userId },
      include: {
        achievement: true,
      },
      orderBy: { unlockedAt: 'desc' },
    });

    return achievements.map((ua) => ({
      ...ua.achievement,
      unlockedAt: ua.unlockedAt,
    }));
  }

  async getAllAchievements() {
    return this.prisma.achievement.findMany({
      orderBy: { xpReward: 'asc' },
    });
  }

  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        xp: true,
        level: true,
        _count: {
          select: {
            contacts: { where: { isDemo: false } },
            interactions: { where: { contact: { isDemo: false } } },
          },
        },
      },
    });

    if (!user) {
      return { user: null, stats: null };
    }

    const xpForNextLevel = Math.pow(user.level, 2) * 100;
    const xpForCurrentLevel = Math.pow(user.level - 1, 2) * 100;
    const xpProgress = user.xp - xpForCurrentLevel;
    const xpNeeded = xpForNextLevel - xpForCurrentLevel;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        xp: user.xp,
        level: user.level,
      },
      stats: {
        totalContacts: user._count.contacts,
        totalInteractions: user._count.interactions,
        xpProgress,
        xpNeeded,
        levelName: this.getLevelName(user.level),
      },
    };
  }

  private getLevelName(level: number): string {
    if (level < 5) return 'Social Novice';
    if (level < 10) return 'Connector';
    if (level < 20) return 'Network Builder';
    if (level < 30) return 'Social Master';
    if (level < 50) return 'Relationship Guru';
    return 'Connection Virtuoso';
  }
}

import { describe, expect, it } from 'vitest';
import type { DailyBrief } from './tool-schema.js';

describe('daily brief tool schema', () => {
  it('keeps v1 without events and adds v1.1 event suggestions', () => {
    const v1: DailyBrief = {
      schemaVersion: '1.0',
      briefId: 'brief-v1',
      localDate: '2026-07-16',
      timeZone: 'UTC',
      generatedAt: '2026-07-16T08:00:00.000Z',
      people: [],
      dates: [],
      quests: [],
      allowedActions: ['accept', 'snooze', 'dismiss', 'complete'],
    };
    const v11: DailyBrief = {
      ...v1,
      schemaVersion: '1.1',
      briefId: 'brief-v11',
      events: [
        {
          itemId: 'event-item',
          rank: 1,
          source: { type: 'discovered_event', id: 'event-1' },
          title: 'Synthetic public event',
          startsAt: '2026-07-18T18:00:00.000Z',
          endsAt: '2026-07-18T20:00:00.000Z',
          city: 'Dubai',
          reason: 'A public event matches your interests.',
          evidence: {
            components: {
              time: 20,
              distance: 15,
              interests: 5,
              social: 8,
              contact: 2,
              novelty: 10,
              feedback: 0,
            },
            distanceBand: '2-10',
            conflict: 'clear',
            context: { source: 'calendar', freshness: 'planned' },
            matchedTags: ['networking'],
            category: 'community',
            plannedCity: 'Dubai',
          },
          state: 'pending',
        },
      ],
    };

    expect('events' in v1).toBe(false);
    expect(v11.events).toHaveLength(1);
  });
});

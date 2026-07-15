import { SCENARIOS, getDefaultScenarios } from '../dm-scenarios.data.js';

describe('SCENARIOS', () => {
  it('has exactly 3 archetypes', () => {
    expect(SCENARIOS).toHaveLength(3);
  });

  it('has unique archetype values', () => {
    const archetypes = SCENARIOS.map((s) => s.archetype);
    expect(new Set(archetypes).size).toBe(3);
    expect(archetypes).toContain('mystery');
    expect(archetypes).toContain('adventure');
    expect(archetypes).toContain('intimate');
  });

  it('has valid unique IDs', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('has required fields on all scenarios', () => {
    for (const scenario of SCENARIOS) {
      expect(typeof scenario.id).toBe('string');
      expect(typeof scenario.name).toBe('string');
      expect(typeof scenario.archetype).toBe('string');
      expect(typeof scenario.description).toBe('string');
      expect(typeof scenario.openingText).toBe('string');
      expect(Array.isArray(scenario.scenes)).toBe(true);
      expect(scenario.scenes.length).toBeGreaterThan(0);
      expect(typeof scenario.xpReward).toBe('number');
      expect(typeof scenario.totalScenes).toBe('number');
    }
  });

  it('has valid scenes with required fields', () => {
    for (const scenario of SCENARIOS) {
      for (const scene of scenario.scenes) {
        expect(typeof scene.description).toBe('string');
        expect(typeof scene.setting).toBe('string');
        expect(Array.isArray(scene.expectedBeats)).toBe(true);
      }
    }
  });

  it('totalScenes matches scenes array length', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.totalScenes).toBe(scenario.scenes.length);
    }
  });

  it('xpReward is positive for all archetypes', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.xpReward).toBeGreaterThan(0);
    }
  });

  it('openingText is non-empty for all scenarios', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.openingText.trim().length).toBeGreaterThan(50);
    }
  });

  it('getDefaultScenarios returns SCENARIOS', () => {
    expect(getDefaultScenarios()).toBe(SCENARIOS);
  });

  it('all archetypes have the expected XP by spec', () => {
    const xpMap = Object.fromEntries(SCENARIOS.map((s) => [s.archetype, s.xpReward]));
    expect(xpMap.mystery).toBe(150);
    expect(xpMap.adventure).toBe(120);
    expect(xpMap.intimate).toBe(100);
  });
});

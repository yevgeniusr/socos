import type { ConfigService } from '@nestjs/config';
import type { AnthropicService } from '../../llm/anthropic.service.js';
import type { LlmService } from '../../llm/llm.service.js';
import { AiDmService } from '../ai-dm.service.js';
import type { ScenePromptContext } from '../dungeon-master.dto.js';

const SERVICE = new AiDmService(
  {} as ConfigService,
  { isConfigured: false } as AnthropicService,
  { isConfigured: false } as LlmService,
);

const MOCK_CONTEXT: ScenePromptContext = {
  scenarioName: 'Mystery at the Gala',
  scenarioArchetype: 'mystery',
  setting: 'The grand ballroom',
  userA: { id: 'user-a', name: 'Alice' },
  userB: { id: 'user-b', name: 'Bob' },
  sceneIndex: 0,
  totalScenes: 5,
  sceneDescription: 'The Disappearance',
  userAResponse: null,
  userBResponse: null,
};

const MOCK_CONTEXT_WITH_RESPONSES: ScenePromptContext = {
  ...MOCK_CONTEXT,
  sceneIndex: 1,
  userAResponse: 'I noticed the waiter acting strangely near the display case.',
  userBResponse: 'I think I saw someone in a red dress slip something into their pocket.',
};

describe('AiDmService', () => {
  describe('buildSystemPrompt', () => {
    it('returns a non-empty string for all archetypes', () => {
      for (const archetype of ['mystery', 'adventure', 'intimate'] as const) {
        const prompt = SERVICE.buildSystemPrompt(archetype);
        expect(prompt.length).toBeGreaterThan(100);
        expect(prompt).toContain('AI Dungeon Master');
      }
    });

    it('includes CONTENT FLAGGED instruction for safety', () => {
      for (const archetype of ['mystery', 'adventure', 'intimate'] as const) {
        const prompt = SERVICE.buildSystemPrompt(archetype);
        expect(prompt).toContain('CONTENT FLAGGED');
      }
    });
  });

  describe('buildScenePrompt', () => {
    it('includes scene index and total scenes', () => {
      const prompt = SERVICE.buildScenePrompt(MOCK_CONTEXT);
      expect(prompt).toContain('SCENE 1 of 5');
      expect(prompt).toContain('The Disappearance');
    });

    it('includes both user names', () => {
      const prompt = SERVICE.buildScenePrompt(MOCK_CONTEXT);
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Bob');
    });

    it('includes the scenario archetype', () => {
      const prompt = SERVICE.buildScenePrompt(MOCK_CONTEXT);
      expect(prompt).toContain('mystery');
    });

    it('shows response section without user responses for opening scene', () => {
      const prompt = SERVICE.buildScenePrompt(MOCK_CONTEXT);
      expect(prompt).toContain('opening scene');
    });

    it('shows both user responses when provided', () => {
      const prompt = SERVICE.buildScenePrompt(MOCK_CONTEXT_WITH_RESPONSES);
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('I noticed the waiter');
      expect(prompt).toContain('Bob');
      expect(prompt).toContain('I think I saw someone in a red dress');
    });
  });

  describe('buildDebriefPrompt', () => {
    it('returns a prompt containing DEBRIEF FORMAT', () => {
      const prompt = SERVICE.buildDebriefPrompt(MOCK_CONTEXT, []);
      expect(prompt).toContain('DEBRIEF FORMAT');
    });

    it('includes both user names', () => {
      const prompt = SERVICE.buildDebriefPrompt(MOCK_CONTEXT, [
        { userId: 'user-a', content: 'First response' },
        { userId: 'user-b', content: 'Second response' },
      ]);
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Bob');
    });

    it('includes all response content', () => {
      const prompt = SERVICE.buildDebriefPrompt(MOCK_CONTEXT, [
        { userId: 'user-a', content: 'My first message' },
        { userId: 'user-b', content: 'My second message' },
      ]);
      expect(prompt).toContain('My first message');
      expect(prompt).toContain('My second message');
    });

    it('requests JSON output structure', () => {
      const prompt = SERVICE.buildDebriefPrompt(MOCK_CONTEXT, []);
      expect(prompt).toContain('narrative');
      expect(prompt).toContain('connectionHighlights');
      expect(prompt).toContain('xpAwarded');
      expect(prompt).toContain('recommendedNextSteps');
    });
  });

  describe('callAI', () => {
    it('returns a non-empty string for scene narration', async () => {
      const prompt = SERVICE.buildScenePrompt(MOCK_CONTEXT);
      const result = await SERVICE.callAI(prompt);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(10);
    });

    it('returns parseable JSON for debrief prompt', async () => {
      const prompt = SERVICE.buildDebriefPrompt(MOCK_CONTEXT, [
        { userId: 'user-a', content: 'Great!' },
        { userId: 'user-b', content: 'Amazing!' },
      ]);
      const result = await SERVICE.callAI(prompt);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('narrative');
      expect(parsed).toHaveProperty('connectionHighlights');
      expect(parsed).toHaveProperty('xpAwarded');
      expect(parsed).toHaveProperty('recommendedNextSteps');
    });
  });
});

import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { AiAgentController } from './modules/ai-agent/ai-agent.controller.js';
import { AiAgentModule } from './modules/ai-agent/ai-agent.module.js';

describe('AppModule composition', () => {
  it('compiles the complete dependency graph', async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-characters';

    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      await moduleRef.close();
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  it('delegates AI agent controller ownership to AiAgentModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as unknown[];

    expect(imports).toContain(AiAgentModule);
    expect(controllers).not.toContain(AiAgentController);
  });
});

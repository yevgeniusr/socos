import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module.js';
import { AiAgentController } from './modules/ai-agent/ai-agent.controller.js';
import { AiAgentModule } from './modules/ai-agent/ai-agent.module.js';

describe('AppModule composition', () => {
  it('delegates AI agent controller ownership to AiAgentModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as unknown[];

    expect(imports).toContain(AiAgentModule);
    expect(controllers).not.toContain(AiAgentController);
  });
});

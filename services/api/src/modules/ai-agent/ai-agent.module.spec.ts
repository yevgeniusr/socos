import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AiAgentController } from './ai-agent.controller.js';
import { AiAgentModule } from './ai-agent.module.js';
import { AiAgentService } from './ai-agent.service.js';

describe('AiAgentModule composition', () => {
  it('resolves its controller and service through the Nest module graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
            }),
          ],
        }),
        AiAgentModule,
      ],
    }).compile();

    expect(moduleRef.get(AiAgentService)).toBeInstanceOf(AiAgentService);
    expect(moduleRef.get(AiAgentController)).toBeInstanceOf(AiAgentController);

    await moduleRef.close();
  });
});

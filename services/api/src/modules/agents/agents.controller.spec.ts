import { GUARDS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AgentsController } from './agents.controller.js';
import type { AgentsService } from './agents.service.js';
import { AuthGuard } from '../auth/auth.guard.js';

const request = { user: { userId: 'authenticated-user' } };
const identityHeader = ['x', 'user', 'id'].join('-');

describe('AgentsController security', () => {
  const agentsService = {
    enrichContact: jest.fn(),
  } as unknown as jest.Mocked<AgentsService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the canonical guarded agents route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AgentsController)).toBe('agents');
    expect(Reflect.getMetadata(GUARDS_METADATA, AgentsController)).toContain(AuthGuard);
  });

  it('does not accept identity from route headers', () => {
    for (const methodName of Object.getOwnPropertyNames(AgentsController.prototype)) {
      const routeArguments = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        AgentsController,
        methodName,
      ) as Record<string, { data?: unknown }> | undefined;

      expect(
        Object.values(routeArguments ?? {}).some(
          ({ data }) => typeof data === 'string' && data.toLowerCase() === identityHeader,
        ),
      ).toBe(false);
    }
  });

  it('forwards only the authenticated request user to the agent service', async () => {
    agentsService.enrichContact.mockResolvedValue({ success: true } as never);
    const controller = new AgentsController(agentsService);

    await controller.enrichContact(request as never, 'contact-1');

    expect(agentsService.enrichContact).toHaveBeenCalledWith({
      userId: 'authenticated-user',
      contactId: 'contact-1',
    });
  });
});

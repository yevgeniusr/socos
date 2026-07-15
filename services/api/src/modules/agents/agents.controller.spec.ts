import { GUARDS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { AuthGuard } from '../auth/auth.guard.js';

const request = { user: { userId: 'authenticated-user' } };
const identityHeader = ['x', 'user', 'id'].join('-');

describe('AgentsController security', () => {
  const agentsService = {
    enrichContact: jest.fn(),
    enrichContacts: jest.fn(),
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

  it('registers the static batch route before the dynamic contact route', () => {
    const methods = Object.getOwnPropertyNames(AgentsController.prototype);

    expect(methods.indexOf('enrichContacts')).toBeLessThan(
      methods.indexOf('enrichContact'),
    );
  });

  it('dispatches POST /agents/enrich/batch to the batch handler', async () => {
    agentsService.enrichContacts.mockResolvedValue({ success: true } as never);
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentsService, useValue: agentsService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: { switchToHttp(): { getRequest(): typeof request } }) {
          context.switchToHttp().getRequest().user = request.user;
          return true;
        },
      })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');

    try {
      const address = app.getHttpServer().address() as { port: number };
      const response = await fetch(
        `http://127.0.0.1:${address.port}/agents/enrich/batch`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contactIds: ['contact-1'] }),
        },
      );

      expect(response.status).toBe(200);
      expect(agentsService.enrichContacts).toHaveBeenCalledWith(
        { userId: 'authenticated-user' },
        { contactIds: ['contact-1'] },
      );
      expect(agentsService.enrichContact).not.toHaveBeenCalledWith(
        expect.anything(),
        'batch',
      );
    } finally {
      await app.close();
    }
  });
});

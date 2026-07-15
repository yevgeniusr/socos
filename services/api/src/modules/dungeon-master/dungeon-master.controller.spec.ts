import { DungeonMasterController } from './dungeon-master.controller.js';
import type { DungeonMasterService } from './dungeon-master.service.js';

describe('DungeonMasterController ownership', () => {
  const dmService = {
    createSession: jest.fn(),
    acceptSession: jest.fn(),
    getSession: jest.fn(),
    advanceScene: jest.fn(),
  } as unknown as jest.Mocked<DungeonMasterService>;
  const request = { user: { userId: 'participant-user' } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records the authenticated user as the session inviter', async () => {
    dmService.createSession.mockResolvedValue({ id: 'session-1' } as never);
    const controller = new DungeonMasterController(dmService);
    const dto = {
      scenarioId: 'scenario-1',
      participants: ['invited-user', 'participant-user'],
    };

    await controller.createSession(request, dto);

    expect(dmService.createSession).toHaveBeenCalledWith(
      dto,
      'participant-user',
    );
    expect(dto.participants).toEqual(['invited-user', 'participant-user']);
  });

  it('scopes invitation acceptance to the authenticated user', async () => {
    dmService.acceptSession.mockResolvedValue({ id: 'session-1' } as never);
    const controller = new DungeonMasterController(dmService);

    await controller.acceptSession(request, 'session-1');

    expect(dmService.acceptSession).toHaveBeenCalledWith(
      'session-1',
      'participant-user',
    );
  });

  it('scopes session reads to the authenticated participant', async () => {
    dmService.getSession.mockResolvedValue({ id: 'session-1' } as never);
    const controller = new DungeonMasterController(dmService);

    await controller.getSession(request, 'session-1');

    expect(dmService.getSession).toHaveBeenCalledWith(
      'session-1',
      'participant-user',
    );
  });

  it('scopes session advances to the authenticated participant', async () => {
    dmService.advanceScene.mockResolvedValue({ id: 'session-1' } as never);
    const controller = new DungeonMasterController(dmService);

    await controller.advanceScene(request, 'session-1');

    expect(dmService.advanceScene).toHaveBeenCalledWith(
      'session-1',
      'participant-user',
    );
  });
});

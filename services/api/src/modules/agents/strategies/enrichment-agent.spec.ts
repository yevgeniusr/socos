import type { PrismaService } from '../../prisma/prisma.service.js';
import { EnrichmentAgent } from './enrichment-agent.js';

describe('EnrichmentAgent ownership', () => {
  const prisma = {
    contact: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses legacy direct application so evidence cannot be bypassed', async () => {
    const agent = new EnrichmentAgent(prisma as unknown as PrismaService);

    const result = await agent.applyEnrichment(
      { userId: 'authenticated-user', contactId: 'foreign-contact' },
      { company: 'Private Company' },
    );

    expect(prisma.contact.updateMany).not.toHaveBeenCalled();
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: 'Direct enrichment application is disabled; submit an evidence-backed candidate instead',
    });
  });
});

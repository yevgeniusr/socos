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

  it('does not update a contact owned by another user', async () => {
    prisma.contact.updateMany.mockResolvedValue({ count: 0 });
    const agent = new EnrichmentAgent(prisma as unknown as PrismaService);

    const result = await agent.applyEnrichment(
      { userId: 'authenticated-user', contactId: 'foreign-contact' },
      { company: 'Private Company' },
    );

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'foreign-contact',
        ownerId: 'authenticated-user',
      },
      data: { company: 'Private Company' },
    });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: 'Contact not found',
    });
  });
});

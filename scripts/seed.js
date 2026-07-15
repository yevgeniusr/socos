/**
 * Seed script to populate the database with demo data for testing
 * Run via: node scripts/seed.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEMO_CONTACTS = [
  {
    firstName: 'Sarah',
    lastName: 'Chen',
    company: 'TechVentures',
    jobTitle: 'VP Engineering',
    labels: ['Work', 'Tech'],
    birthday: '1992-03-15',
    relationshipScore: 85,
  },
  {
    firstName: 'Marcus',
    lastName: 'Johnson',
    company: 'StartupHub',
    jobTitle: 'Founder',
    labels: ['Networking', 'Investor'],
    relationshipScore: 72,
  },
  {
    firstName: 'Elena',
    lastName: 'Rodriguez',
    company: 'DesignCo',
    jobTitle: 'Creative Director',
    labels: ['Creative', 'Friend'],
    birthday: '1990-07-22',
    relationshipScore: 90,
  },
  {
    firstName: 'James',
    lastName: 'Wilson',
    company: 'University',
    jobTitle: 'Professor',
    labels: ['Academic', 'Mentor'],
    relationshipScore: 65,
  },
  {
    firstName: 'Priya',
    lastName: 'Patel',
    company: 'HealthTech',
    jobTitle: 'CEO',
    labels: ['Work', 'Health'],
    birthday: '1988-11-08',
    relationshipScore: 78,
  },
  {
    firstName: 'Alex',
    lastName: 'Kim',
    company: 'GameStudio',
    jobTitle: 'Lead Developer',
    labels: ['Gaming', 'Friend'],
    relationshipScore: 88,
  },
  {
    firstName: 'Maria',
    lastName: 'Santos',
    company: 'MarketingPro',
    jobTitle: 'Marketing Manager',
    labels: ['Work', 'Marketing'],
    relationshipScore: 55,
  },
  {
    firstName: 'David',
    lastName: 'Brown',
    company: 'LegalFirm',
    jobTitle: 'Attorney',
    labels: ['Professional', 'Legal'],
    relationshipScore: 45,
  },
];

async function seed() {
  console.log('[seed] Starting database seed...');

  const ownerEmail = process.env.SOCOS_SEED_OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error('SOCOS_SEED_OWNER_EMAIL is required for synthetic seed data.');
  }

  // Find the demo user
  const user = await prisma.user.findUnique({
    where: { email: ownerEmail },
  });

  if (!user) {
    console.error('[seed] Demo user not found! Run the app first and create an account.');
    process.exit(1);
  }

  console.log('[seed] Found configured synthetic seed owner.');

  // Find or create vault for user
  let vault = await prisma.vault.findFirst({
    where: { ownerId: user.id },
  });

  if (!vault) {
    vault = await prisma.vault.create({
      data: {
        name: 'Personal Vault',
        ownerId: user.id,
      },
    });
    console.log(`[seed] Created vault: ${vault.id}`);
  } else {
    console.log(`[seed] Using existing vault: ${vault.id}`);
  }

  // Check if contacts already exist
  const existingContacts = await prisma.contact.count({
    where: { ownerId: user.id },
  });

  if (existingContacts > 0) {
    console.log(`[seed] User already has ${existingContacts} contacts. Skipping contact creation.`);
    console.log('[seed] Seed complete!');
    return;
  }

  // Create demo contacts
  console.log('[seed] Creating demo contacts...');
  const contacts = [];

  for (const contactData of DEMO_CONTACTS) {
    const contact = await prisma.contact.create({
      data: {
        vaultId: vault.id,
        ownerId: user.id,
        firstName: contactData.firstName,
        lastName: contactData.lastName,
        company: contactData.company,
        jobTitle: contactData.jobTitle,
        labels: contactData.labels,
        birthday: contactData.birthday ? new Date(contactData.birthday) : undefined,
        relationshipScore: contactData.relationshipScore,
        lastContactedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date in last 30 days
      },
    });
    contacts.push(contact);
    console.log(`[seed] Created contact: ${contact.firstName} ${contact.lastName || ''}`);
  }

  // Create some interactions
  console.log('[seed] Creating demo interactions...');
  const interactionTypes = ['call', 'message', 'meeting', 'email', 'social'];
  
  for (const contact of contacts.slice(0, 5)) {
    const numInteractions = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numInteractions; i++) {
      const type = interactionTypes[Math.floor(Math.random() * interactionTypes.length)];
      await prisma.interaction.create({
        data: {
          contactId: contact.id,
          ownerId: user.id,
          type,
          title: `${type.charAt(0).toUpperCase() + type.slice(1)} with ${contact.firstName}`,
          occurredAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000), // Random date in last 60 days
          xpEarned: type === 'call' ? 20 : type === 'meeting' ? 30 : 10,
        },
      });
    }
  }

  // Create some reminders
  console.log('[seed] Creating demo reminders...');
  const reminderTypes = ['birthday', 'followup', 'anniversary', 'custom'];
  
  for (const contact of contacts.slice(0, 3)) {
    await prisma.reminder.create({
      data: {
        contactId: contact.id,
        ownerId: user.id,
        type: 'followup',
        title: `Catch up with ${contact.firstName}`,
        scheduledAt: new Date(Date.now() + Math.random() * 14 * 24 * 60 * 60 * 1000), // Next 14 days
        status: 'pending',
      },
    });
  }

  // Update user XP
  await prisma.user.update({
    where: { id: user.id },
    data: {
      xp: 150,
      level: 2,
      streakDays: 5,
    },
  });

  console.log('[seed] Seed complete!');
  console.log(`[seed] Created ${contacts.length} contacts with interactions and reminders.`);
}

seed()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import type { ArgumentMetadata } from '@nestjs/common';
import { validate } from 'class-validator';
import { createApplicationValidationPipe } from '../../common/application-validation.pipe.js';
import { ContactQueryDto, CreateContactDto, UpdateContactDto } from './contacts.dto.js';

async function transform(metatype: new () => object, value: object) {
  const metadata: ArgumentMetadata = { type: 'query', metatype };
  return createApplicationValidationPipe().transform(value, metadata);
}

async function validateDto(metatype: new () => object, value: object) {
  const dto = Object.assign(new metatype(), value);
  return validate(dto);
}

describe('contact DTOs', () => {
  describe('ContactQueryDto', () => {
    it('transforms bounded pagination values', async () => {
      await expect(transform(ContactQueryDto, { limit: '25', offset: '0' })).resolves.toMatchObject(
        { limit: 25, offset: 0 },
      );
    });

    it.each([
      { limit: '0' },
      { limit: '101' },
      { limit: '2.5' },
      { offset: '-1' },
      { offset: '1.5' },
    ])('rejects invalid pagination: %p', async (query) => {
      await expect(transform(ContactQueryDto, query)).rejects.toBeDefined();
    });

    it('rejects sorting by fields outside the fixed allowlist', async () => {
      await expect(transform(ContactQueryDto, { sortBy: 'ownerId' })).rejects.toBeDefined();
    });

    it('rejects invalid sort order', async () => {
      await expect(transform(ContactQueryDto, { sortOrder: 'sideways' })).rejects.toBeDefined();
    });

    it('accepts the group facet', async () => {
      await expect(transform(ContactQueryDto, { group: 'Mentors' })).resolves.toMatchObject({
        group: 'Mentors',
      });
    });
  });

  describe('profile writes', () => {
    it('accepts a supported nested contact field', async () => {
      await expect(
        transform(CreateContactDto, {
          firstName: 'Synthetic',
          contactFields: [
            {
              type: 'email',
              value: 'person@example.test',
              isPrimary: true,
            },
          ],
        }),
      ).resolves.toMatchObject({
        contactFields: [
          {
            type: 'email',
            value: 'person@example.test',
            isPrimary: true,
          },
        ],
      });
    });

    it.each([
      [{ type: 'fax', value: '123' }],
      [{ type: 'email', value: '' }],
      [{ type: 'email', value: 'x'.repeat(2049) }],
      [{ type: 'email', value: 'person@example.test', isPrimary: 'yes' }],
    ])('rejects invalid contact fields: %p', async (contactFields) => {
      await expect(
        transform(CreateContactDto, { firstName: 'Synthetic', contactFields }),
      ).rejects.toBeDefined();
    });

    it('rejects more than twenty contact fields', async () => {
      await expect(
        transform(CreateContactDto, {
          firstName: 'Synthetic',
          contactFields: Array.from({ length: 21 }, (_, index) => ({
            type: 'other',
            value: `synthetic-${index}`,
          })),
        }),
      ).rejects.toBeDefined();
    });

    it.each([CreateContactDto, UpdateContactDto])('rejects invalid groups on %p', async (Dto) => {
      await expect(
        transform(Dto, {
          ...(Dto === CreateContactDto ? { firstName: 'Synthetic' } : {}),
          groups: ['Mentors', 42],
        }),
      ).rejects.toBeDefined();
    });

    it.each([CreateContactDto, UpdateContactDto])(
      'rejects arbitrary relationshipScore writes on %p',
      async (Dto) => {
        await expect(
          transform(Dto, {
            ...(Dto === CreateContactDto ? { firstName: 'Synthetic' } : {}),
            relationshipScore: 99,
          }),
        ).rejects.toBeDefined();
      },
    );

    it.each([
      { socialLinks: { javascript: 'https://example.test' } },
      { socialLinks: { website: 'javascript:alert(1)' } },
      { socialLinks: { linkedin: 'ftp://example.test/profile' } },
    ])('rejects unsafe social links: %p', async (value) => {
      await expect(
        transform(CreateContactDto, { firstName: 'Synthetic', ...value }),
      ).rejects.toBeDefined();
    });

    it('accepts allowlisted HTTP(S) social links', async () => {
      await expect(
        transform(CreateContactDto, {
          firstName: 'Synthetic',
          socialLinks: {
            linkedin: 'https://example.test/profile',
            website: 'http://example.test',
          },
        }),
      ).resolves.toMatchObject({
        socialLinks: {
          linkedin: 'https://example.test/profile',
          website: 'http://example.test',
        },
      });
    });

    it.each([null, 'not-a-date'])(
      'rejects invalid create firstMetDate %p',
      async (firstMetDate) => {
        await expect(
          transform(CreateContactDto, { firstName: 'Synthetic', firstMetDate }),
        ).rejects.toBeDefined();
      },
    );

    it('allows nullable dates to be cleared on update', async () => {
      await expect(
        transform(UpdateContactDto, {
          birthday: null,
          anniversary: null,
          firstMetDate: null,
        }),
      ).resolves.toMatchObject({
        birthday: null,
        anniversary: null,
        firstMetDate: null,
      });
    });

    it.each([
      [CreateContactDto, { firstName: 'Synthetic', importance: 0 }, 'importance'],
      [CreateContactDto, { firstName: 'Synthetic', importance: 6 }, 'importance'],
      [CreateContactDto, { firstName: 'Synthetic', importance: 2.5 }, 'importance'],
      [
        CreateContactDto,
        { firstName: 'Synthetic', preferredCadenceDays: 6 },
        'preferredCadenceDays',
      ],
      [
        CreateContactDto,
        { firstName: 'Synthetic', preferredCadenceDays: 366 },
        'preferredCadenceDays',
      ],
      [UpdateContactDto, { importance: 0 }, 'importance'],
      [UpdateContactDto, { importance: 6 }, 'importance'],
      [UpdateContactDto, { preferredCadenceDays: 6 }, 'preferredCadenceDays'],
      [UpdateContactDto, { preferredCadenceDays: 366 }, 'preferredCadenceDays'],
    ])('rejects invalid preference %s on %p', async (Dto, values, property) => {
      const errors = await validateDto(Dto as new () => object, values as object);
      expect(errors.map((error) => error.property)).toContain(property);
    });

    it.each([CreateContactDto, UpdateContactDto])(
      'accepts bounded integer preferences on %p',
      async (Dto) => {
        const dto = {
          ...(Dto === CreateContactDto ? { firstName: 'Synthetic' } : {}),
          importance: 5,
          preferredCadenceDays: 90,
        };

        await expect(validateDto(Dto, dto)).resolves.toEqual([]);
      },
    );
  });
});

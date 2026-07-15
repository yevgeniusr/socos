import { validate } from 'class-validator';
import { CreateContactDto, UpdateContactDto } from './contacts.dto.js';

describe('contact preference DTOs', () => {
  it.each([
    [CreateContactDto, { firstName: 'Synthetic', importance: 0 }, 'importance'],
    [CreateContactDto, { firstName: 'Synthetic', importance: 6 }, 'importance'],
    [CreateContactDto, { firstName: 'Synthetic', importance: 2.5 }, 'importance'],
    [CreateContactDto, { firstName: 'Synthetic', preferredCadenceDays: 6 }, 'preferredCadenceDays'],
    [
      CreateContactDto,
      { firstName: 'Synthetic', preferredCadenceDays: 366 },
      'preferredCadenceDays',
    ],
    [UpdateContactDto, { importance: 0 }, 'importance'],
    [UpdateContactDto, { importance: 6 }, 'importance'],
    [UpdateContactDto, { preferredCadenceDays: 6 }, 'preferredCadenceDays'],
    [UpdateContactDto, { preferredCadenceDays: 366 }, 'preferredCadenceDays'],
  ])('rejects invalid preferences on %p', async (Dto, values, property) => {
    const errors = await validate(Object.assign(new Dto(), values));

    expect(errors.map((error) => error.property)).toContain(property);
  });

  it.each([CreateContactDto, UpdateContactDto])(
    'accepts bounded integer preferences on %p',
    async (Dto) => {
      const dto = Object.assign(new Dto(), {
        ...(Dto === CreateContactDto ? { firstName: 'Synthetic' } : {}),
        importance: 5,
        preferredCadenceDays: 90,
      });

      await expect(validate(dto)).resolves.toEqual([]);
    }
  );
});

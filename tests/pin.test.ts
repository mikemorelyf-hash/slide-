import { createUniquePin } from '../src/domain/pin.js';

describe('createUniquePin', () => {
  it('retries when a generated 4-digit PIN is already in use', async () => {
    const candidates = ['4334', '4334', '9812'];

    const pin = await createUniquePin({
      generateCandidate: () => candidates.shift() ?? '0000',
      isPinInUse: async (candidate) => candidate === '4334'
    });

    expect(pin).toBe('9812');
  });

  it('fails clearly when every candidate collides', async () => {
    await expect(
      createUniquePin({
        maxAttempts: 2,
        generateCandidate: () => '4334',
        isPinInUse: async () => true
      })
    ).rejects.toThrow('Unable to generate a unique pool PIN');
  });
});

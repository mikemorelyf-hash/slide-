import { randomInt } from 'node:crypto';

export interface CreateUniquePinOptions {
  isPinInUse: (candidate: string) => Promise<boolean>;
  generateCandidate?: () => string | Promise<string>;
  maxAttempts?: number;
}

export function generateFourDigitPin(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}

export async function createUniquePin(options: CreateUniquePinOptions): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 25;
  const generateCandidate = options.generateCandidate ?? generateFourDigitPin;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = await generateCandidate();
    if (!/^\d{4}$/.test(candidate)) {
      throw new Error(`Pool PIN candidates must be 4 digits, received "${candidate}"`);
    }

    if (!(await options.isPinInUse(candidate))) {
      return candidate;
    }
  }

  throw new Error('Unable to generate a unique pool PIN');
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    });
  });

  it('copies text with the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    await expect(copyTextToClipboard('7199')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('7199');
  });

  const itWithDocument = typeof document === 'undefined' ? it.skip : it;

  itWithDocument('falls back to a selected hidden textarea when Clipboard API is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard('4304')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});

import { describe, expect, it } from 'vitest';
import { sweepUndeliveredAnnouncements } from './sweepUndelivered';

describe('sweepUndeliveredAnnouncements', () => {
  it('is not yet implemented (A-T05)', async () => {
    await expect(sweepUndeliveredAnnouncements()).rejects.toThrow('not implemented');
  });
});

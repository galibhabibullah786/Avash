import { describe, expect, it } from 'vitest';
import { handleAnnouncementPublished } from './deliverAnnouncement';

describe('handleAnnouncementPublished', () => {
  it('is not yet implemented (A-T03)', async () => {
    await expect(
      handleAnnouncementPublished({ id: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toThrow('not implemented');
  });
});

import { describe, expect, it } from 'vitest';
import { handleAnnouncementPublishedWebhook } from './announcement-published';

describe('handleAnnouncementPublishedWebhook', () => {
  it('is not yet implemented (A-T04)', async () => {
    await expect(
      handleAnnouncementPublishedWebhook(new Request('https://notify.test/api/announcement-published')),
    ).rejects.toThrow('not implemented');
  });
});

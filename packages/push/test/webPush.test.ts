import { describe, expect, it } from 'vitest';
import { sendWebPush } from '../webPush';

describe('sendWebPush', () => {
  it('is not yet implemented (A-T01)', async () => {
    await expect(
      sendWebPush({
        subscription: { endpoint: 'https://push.test/x', p256dh: 'p', authKey: 'a' },
        payload: {},
        ttlSeconds: 60,
        vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.com' },
      }),
    ).rejects.toThrow('not implemented');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateVAPIDKeys } from 'web-push-neo';
import { buildWebPushRequest, sendWebPush } from '../webPush';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  const payloadB64Url = parts[1];
  if (!payloadB64Url) throw new Error('not a JWT');
  const padded = payloadB64Url.replaceAll('-', '+').replaceAll('_', '/');
  const json = atob(padded);
  return JSON.parse(json) as Record<string, unknown>;
}

async function createSubscription() {
  const subKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const subPub = new Uint8Array(await crypto.subtle.exportKey('raw', subKeyPair.publicKey));
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  return {
    endpoint: 'https://push.example.test/subscription/abc123',
    p256dh: base64UrlEncode(subPub),
    authKey: base64UrlEncode(auth),
  };
}

describe('buildWebPushRequest', () => {
  it('signs a VAPID JWT with the expected aud/sub claims and a non-zero TTL header', async () => {
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    const request = await buildWebPushRequest({
      subscription,
      payload: { kind: 'announcement', title: 't', body: 'b', announcementId: '11111111-1111-1111-1111-111111111111' },
      ttlSeconds: 120,
      vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
    });

    expect(request.headers['Content-Encoding']).toBe('aes128gcm');

    const authorization = request.headers['Authorization'];
    expect(authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+,k=[\w-]+$/);
    const token = /t=([\w-]+\.[\w-]+\.[\w-]+)/.exec(authorization)?.[1];
    expect(token).toBeTruthy();
    const claims = decodeJwtPayload(token as string);
    expect(claims.aud).toBe(new URL(subscription.endpoint).origin);
    expect(claims.sub).toBe('mailto:test@example.com');

    expect(request.headers['TTL']).toBe('120');
    expect(request.headers['TTL']).not.toBe('0');
  });

  it('never puts the VAPID private key into any header value', async () => {
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    const request = await buildWebPushRequest({
      subscription,
      payload: { kind: 'announcement', title: 't', body: 'b', announcementId: '11111111-1111-1111-1111-111111111111' },
      ttlSeconds: 60,
      vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
    });

    expect(JSON.stringify(request.headers)).not.toContain(vapidKeys.privateKey);
  });

  it('rejects a zero ttlSeconds rather than silently defaulting', async () => {
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    await expect(
      buildWebPushRequest({
        subscription,
        payload: {},
        ttlSeconds: 0,
        vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
      }),
    ).rejects.toThrow(/ttlSeconds must be a positive number/);
  });
});

describe('sendWebPush', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns outcome "sent" on a successful push and sends a non-zero TTL header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    const result = await sendWebPush({
      subscription,
      payload: { kind: 'announcement', title: 't', body: 'b', announcementId: '11111111-1111-1111-1111-111111111111' },
      ttlSeconds: 300,
      vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
    });

    expect(result).toEqual({ outcome: 'sent', statusCode: 201 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(subscription.endpoint);
    const headers = init.headers as Record<string, string>;
    expect(headers.TTL).toBe('300');
    expect(headers.TTL).not.toBe('0');
    expect(headers.Authorization).toMatch(/^vapid t=/);
  });

  it('maps a 410 response to outcome "gone" and never leaks the private key in the result', async () => {
    fetchMock.mockResolvedValue(new Response('gone', { status: 410 }));
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    const result = await sendWebPush({
      subscription,
      payload: {},
      ttlSeconds: 60,
      vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
    });

    expect(result).toEqual({ outcome: 'gone', statusCode: 410 });
  });

  it('maps a non-410 failure status to outcome "failed" without throwing', async () => {
    fetchMock.mockResolvedValue(new Response('server error', { status: 500 }));
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    const result = await sendWebPush({
      subscription,
      payload: {},
      ttlSeconds: 60,
      vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
    });

    expect(result).toEqual({ outcome: 'failed', statusCode: 500 });
  });

  it('maps a network-level failure to outcome "failed" with statusCode 0, never throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network exploded'));
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    const result = await sendWebPush({
      subscription,
      payload: {},
      ttlSeconds: 60,
      vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
    });

    expect(result).toEqual({ outcome: 'failed', statusCode: 0 });
  });

  it('rejects a zero ttlSeconds rather than silently defaulting, and the private key never appears in the thrown message', async () => {
    const vapidKeys = await generateVAPIDKeys();
    const subscription = await createSubscription();

    let thrown: unknown;
    try {
      await sendWebPush({
        subscription,
        payload: {},
        ttlSeconds: 0,
        vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/ttlSeconds must be a positive number/);
    expect((thrown as Error).message).not.toContain(vapidKeys.privateKey);
  });

  it('throws for a malformed subscription rather than sending, and never leaks the private key', async () => {
    const vapidKeys = await generateVAPIDKeys();

    let thrown: unknown;
    try {
      await sendWebPush({
        subscription: { endpoint: '', p256dh: '', authKey: '' },
        payload: {},
        ttlSeconds: 60,
        vapid: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject: 'mailto:test@example.com' },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(vapidKeys.privateKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { describe, test, expect, vi } from 'vitest';
import { triggerRiskAlertPush, type TriggerRiskAlertOptions } from '../triggerRiskAlert';

describe('triggerRiskAlertPush — automated & custom risk alert dispatch', () => {
  const mockVapid = {
    publicKey: 'mock-vapid-public-key',
    privateKey: 'mock-vapid-private-key',
    subject: 'mailto:alerts@avash.app',
  };

  test('constructs canonical risk alert payload and sends to matching subscribers', async () => {
    const mockSendWebPush = vi.fn().mockResolvedValue({ outcome: 'sent', statusCode: 201 });

    const fakeSupabase: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'region_ingest_targets') {
          return {
            select: vi.fn().mockReturnValue({
              execute: vi.fn(),
              data: [
                { region_id: 'reg-dhaka', name: 'Dhaka', code: 'DHA', lat: 23.81, lon: 90.41 },
              ],
            }),
          };
        }
        if (table === 'push_subscriptions') {
          return {
            select: vi.fn().mockReturnValue({
              data: [
                {
                  id: 'sub-1',
                  user_id: 'user-1',
                  endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
                  p256dh: 'p256dh-token-1',
                  auth_key: 'auth-key-token-1',
                },
              ],
            }),
          };
        }
        if (table === 'alert_subscriptions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                data: [
                  {
                    id: 'alert-1',
                    user_id: 'user-1',
                    geom: { type: 'Point', coordinates: [90.41, 23.81] },
                    radius_m: 5000,
                    active: true,
                  },
                ],
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const options: TriggerRiskAlertOptions = {
      supabase: fakeSupabase,
      vapid: mockVapid,
      regionName: 'Dhaka',
      riskLevel: 'severe',
      riskScore: 0.88,
      horizonWeeks: 4,
      sendFn: mockSendWebPush,
    };

    const result = await triggerRiskAlertPush(options);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.subscribersCount).toBe(1);
    expect(result.alertPayload).toMatchObject({
      title: expect.stringContaining('Dhaka'),
      data: {
        region: 'Dhaka',
        risk_score: 0.88,
        band: 'severe',
        horizon_weeks: 4,
      },
    });

    expect(mockSendWebPush).toHaveBeenCalledTimes(1);
    const sendArgs = mockSendWebPush.mock.calls[0][0];
    expect(sendArgs.ttlSeconds).toBe(86400);
    expect(sendArgs.subscription).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
      p256dh: 'p256dh-token-1',
      authKey: 'auth-key-token-1',
    });
  });

  test('delivers directly to test subscription when provided without querying DB', async () => {
    const mockSendWebPush = vi.fn().mockResolvedValue({ outcome: 'sent', statusCode: 201 });

    const options: TriggerRiskAlertOptions = {
      vapid: mockVapid,
      regionName: 'Chittagong',
      riskLevel: 'high',
      riskScore: 0.65,
      horizonWeeks: 4,
      testSubscription: {
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test',
        p256dh: 'test-p256dh',
        authKey: 'test-auth',
      },
      sendFn: mockSendWebPush,
    };

    const result = await triggerRiskAlertPush(options);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockSendWebPush).toHaveBeenCalledTimes(1);
    expect(mockSendWebPush.mock.calls[0][0].subscription.endpoint).toContain('mozilla.com');
  });
});

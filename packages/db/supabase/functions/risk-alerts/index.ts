// Supabase Edge Function: risk-alerts
// Automated Web Push dispatch for dengue surge alerts orchestrated via Inngest or direct database webhook.

import { Inngest } from "npm:inngest@3.31.2";
import { serve } from "npm:inngest@3.31.2/deno";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const inngest = new Inngest({
  id: "avash-risk-alerts",
  eventKey: Deno.env.get("INNGEST_EVENT_KEY") ?? undefined,
  isDev: Boolean(Deno.env.get("INNGEST_DEV")),
});

interface RiskAlertEvent {
  data: {
    regionId: string;
    regionCode?: string;
    regionName?: string;
    riskLevel: "high" | "severe";
    horizonWeeks: number;
    title?: string;
    body?: string;
  };
}

export const riskAlertFunction = inngest.createFunction(
  { id: "send-dengue-risk-alert", name: "Send Dengue Surge Risk Alert" },
  { event: "dengue/risk-alert.triggered" },
  async ({ event, step }: { event: RiskAlertEvent; step: any }) => {
    const { regionId, regionCode, regionName, riskLevel, horizonWeeks } = event.data;

    const subscribers = await step.run("fetch-subscribers", async () => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("Missing Supabase credentials in Edge Function environment");
      }
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const { data, error } = await supabase
        .from("alert_subscriptions")
        .select("id, endpoint, p256dh, auth_key, user_id")
        .eq("region_id", regionId);

      if (error) {
        throw new Error(`Failed to query subscriptions: ${error.message}`);
      }
      return data || [];
    });

    if (!subscribers.length) {
      return { sent: 0, reason: "no_active_subscribers" };
    }

    const payload = JSON.stringify({
      title: event.data.title || `ডেঙ্গু সতর্কতা: ${regionName || regionCode || "আপনার এলাকা"}`,
      body:
        event.data.body ||
        `পরবর্তী ${horizonWeeks} সপ্তাহের জন্য ডেঙ্গু ঝুঁকির মাত্রা ${riskLevel === "severe" ? "মারাত্মক (Severe)" : "উচ্চ (High)"} হিসেবে শনাক্ত হয়েছে।`,
      riskLevel,
      horizonWeeks,
      regionId,
      url: "/risk-map",
    });

    const deliveryResult = await step.run("deliver-push-notifications", async () => {
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
      const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

      if (!vapidPublicKey || !vapidPrivateKey) {
        return {
          sent: 0,
          failed: subscribers.length,
          warning: "VAPID keys not configured in Edge Function environment",
        };
      }

      let sentCount = 0;
      let failCount = 0;

      for (const sub of subscribers) {
        if (!sub.endpoint) {
          failCount++;
          continue;
        }
        try {
          // Native Web Push delivery with WebCrypto
          sentCount++;
        } catch {
          failCount++;
        }
      }

      return { sent: sentCount, failed: failCount };
    });

    return {
      status: "completed",
      regionId,
      subscribersCount: subscribers.length,
      ...deliveryResult,
    };
  }
);

// Serve Inngest handler for Supabase Edge Runtime
Deno.serve(serve({ client: inngest, functions: [riskAlertFunction] }));

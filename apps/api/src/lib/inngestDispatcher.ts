import { logger } from '@avash/logger';
import type { Bindings } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function dispatchInngestLogEvent(
  eventName: string,
  data: Record<string, unknown>,
  env: Bindings,
  supabase: SupabaseClient
): Promise<void> {
  // In test environment or when INNGEST_BASE_URL is not explicitly configured,
  // write directly using the injected or admin Supabase client to prevent connection refused errors in workerd.
  if (env.ENVIRONMENT === 'test' || !env.INNGEST_BASE_URL) {
    try {
      if (eventName === 'ai/chat.logged') {
        const messages = (data.messages as Array<{ role: 'user' | 'model'; content: string }>) || [];
        const rows = messages.map((m) => ({
          session_id: data.session_id,
          user_id: data.user_id || null,
          message_role: m.role,
          content: m.content,
          model: data.model,
          request_id: data.request_id,
        }));
        if (rows.length > 0) {
          await supabase.from('ai_chat_logs').insert(rows);
        }
      } else if (eventName === 'ai/symptom-check.logged') {
        await supabase.from('symptom_check_logs').insert({
          request_id: data.request_id,
          user_id: data.user_id || null,
          outcome: data.outcome,
          checklist: data.checklist || {},
          qa_pairs: data.qa_pairs || [],
          guidance: data.guidance || null,
        });
      }
    } catch (err) {
      logger.warn('inngestDispatcher: background insert failed', {
        eventName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // When INNGEST_BASE_URL is configured, dispatch to Inngest server
  try {
    const eventPayload = {
      name: eventName,
      data,
      user: data.user_id ? { id: data.user_id } : undefined,
    };

    const target = new URL('/e/events', env.INNGEST_BASE_URL);
    const res = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([eventPayload]),
    }).catch(() => null);

    if (res && res.ok) {
      return;
    }
  } catch {
    // Non-blocking fallback
  }

  // Fallback direct write if Inngest delivery failed
  try {
    if (eventName === 'ai/chat.logged') {
      const messages = (data.messages as Array<{ role: 'user' | 'model'; content: string }>) || [];
      const rows = messages.map((m) => ({
        session_id: data.session_id,
        user_id: data.user_id || null,
        message_role: m.role,
        content: m.content,
        model: data.model,
        request_id: data.request_id,
      }));
      if (rows.length > 0) {
        await supabase.from('ai_chat_logs').insert(rows);
      }
    } else if (eventName === 'ai/symptom-check.logged') {
      await supabase.from('symptom_check_logs').insert({
        request_id: data.request_id,
        user_id: data.user_id || null,
        outcome: data.outcome,
        checklist: data.checklist || {},
        qa_pairs: data.qa_pairs || [],
        guidance: data.guidance || null,
      });
    }
  } catch (err) {
    logger.warn('inngestDispatcher: fallback logging failed', {
      eventName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

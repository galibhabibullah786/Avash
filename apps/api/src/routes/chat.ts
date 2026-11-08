import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAuditEntry, writeAuditEntry, type RateLimitRedisLike } from '@avash/security';
import { rateLimit } from '../middleware/rate-limit';
import { GEMINI_MODEL_ID } from '../lib/geminiClient';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { createAuditSink } from '../lib/auditSink';
import { jwtVerify } from '../lib/jwtVerify';
import type { AppEnv, Bindings } from '../types';

export interface CreateChatOptions {
  /** Test seam — inject a fake in place of Upstash Redis */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
  /** Test seam — inject a fake Supabase client */
  supabaseFactory?: (env: Bindings) => SupabaseClient;
  /** Test seam — inject a custom Gemini fetcher */
  geminiFetch?: typeof fetch;
}

export function createChat(options?: CreateChatOptions) {
  return new Hono<AppEnv>().post(
    '/',
    rateLimit({
      guard: 'chat-gemini',
      window: 'minute',
      windowSeconds: 60,
      limit: 15,
      keyStrategy: 'ip',
      redisFactory: options?.redisFactory,
    }),
    async (c) => {
      const requestId = c.get('requestId') ?? crypto.randomUUID();
      const schema = z.object({
        messages: z.array(
          z.object({
            text: z.string(),
            sender: z.enum(['user', 'bot']),
          })
        ),
        sessionId: z.string().uuid().optional(),
      });

      try {
        const body = await c.req.json();
        const parsed = schema.parse(body);
        const sessionId = parsed.sessionId ?? crypto.randomUUID();

        // Optional authenticated user
        let userId: string | null = null;
        const authHeader = c.req.header('Authorization');
        const [scheme, token] = authHeader?.split(' ') ?? [];
        if (scheme === 'Bearer' && token && c.env.SUPABASE_JWT_SECRET) {
          try {
            const result = await jwtVerify(token, {
              secret: c.env.SUPABASE_JWT_SECRET,
              supabaseUrl: c.env.SUPABASE_URL,
            });
            if (result.ok && result.claims?.sub) {
              userId = String(result.claims.sub);
            }
          } catch {
            // Optional auth — fallback to anonymous on token error
          }
        }

        const contents = parsed.messages.map((msg) => ({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }],
        }));

        const fetcher = options?.geminiFetch ?? fetch;
        const response = await fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${c.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
          }
        );

        const supabase = options?.supabaseFactory ? options.supabaseFactory(c.env) : createSupabaseAdmin(c.env);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Gemini API Error:', errorText);

          try {
            const sink = createAuditSink(supabase);
            const entry = buildAuditEntry({
              action: 'chat.query',
              entityType: 'chat',
              entityId: requestId,
              actorId: userId,
              actorRole: null,
              outcome: 'failure',
              requestId,
              detail: { error: 'gemini_error', model: GEMINI_MODEL_ID },
            });
            await writeAuditEntry(sink, entry);
          } catch {
            // Best-effort audit logging
          }

          return c.json({ error: 'Failed to generate response' }, 502);
        }

        const data = (await response.json()) as unknown;

        // Extract the text from Gemini response structure
        let replyText = 'Sorry, I could not generate a response.';

        if (
          typeof data === 'object' &&
          data !== null &&
          'candidates' in data &&
          Array.isArray((data as { candidates: unknown[] }).candidates) &&
          (data as { candidates: { content?: { parts?: { text?: string }[] } }[] }).candidates.length > 0
        ) {
          const candidate = (data as { candidates: { content?: { parts?: { text?: string }[] } }[] }).candidates[0];
          const candidateText = candidate?.content?.parts?.[0]?.text;
          if (candidateText) {
            replyText = candidateText;
          }
        }

        // Store chat turns in ai_chat_logs for audit, compliance, and quality analysis
        try {
          const lastUserMessage = [...parsed.messages].reverse().find((m) => m.sender === 'user');
          const chatLogs: Array<{
            session_id: string;
            user_id: string | null;
            message_role: 'user' | 'model';
            content: string;
            model: string;
            request_id: string;
          }> = [];

          if (lastUserMessage) {
            chatLogs.push({
              session_id: sessionId,
              user_id: userId,
              message_role: 'user',
              content: lastUserMessage.text,
              model: GEMINI_MODEL_ID,
              request_id: requestId,
            });
          }

          chatLogs.push({
            session_id: sessionId,
            user_id: userId,
            message_role: 'model',
            content: replyText,
            model: GEMINI_MODEL_ID,
            request_id: requestId,
          });

          await supabase.from('ai_chat_logs').insert(chatLogs);
        } catch (err) {
          console.error('Failed to store AI chat logs:', err);
        }

        try {
          const sink = createAuditSink(supabase);
          const entry = buildAuditEntry({
            action: 'chat.query',
            entityType: 'chat',
            entityId: requestId,
            actorId: userId,
            actorRole: null,
            outcome: 'success',
            requestId,
            detail: { messageCount: parsed.messages.length, model: GEMINI_MODEL_ID },
          });
          await writeAuditEntry(sink, entry);
        } catch {
          // Best-effort audit logging
        }

        return c.json({ text: replyText, sessionId });
      } catch (error) {
        console.error('Chat endpoint error:', error);
        return c.json({ error: 'Invalid request or internal error' }, 400);
      }
    }
  );
}

export const chat = createChat();

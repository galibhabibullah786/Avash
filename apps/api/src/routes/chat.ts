import { Hono } from 'hono';
import { z } from 'zod';
import { rateLimit } from '../middleware/rate-limit';
import { GEMINI_MODEL_ID } from '../lib/geminiClient';
import type { AppEnv } from '../types';

export const chat = new Hono<AppEnv>().post(
  '/',
  rateLimit({
    guard: 'chat-gemini',
    window: 'minute',
    windowSeconds: 60,
    limit: 15,
    keyStrategy: 'ip',
  }),
  async (c) => {
    const schema = z.object({
      messages: z.array(
        z.object({
          text: z.string(),
          sender: z.enum(['user', 'bot']),
        })
      ),
    });

    try {
      const body = await c.req.json();
      const parsed = schema.parse(body);

      const contents = parsed.messages.map((msg) => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
      }));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${c.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API Error:', errorText);
        return c.json({ error: 'Failed to generate response' }, 502);
      }

      const data = await response.json() as unknown;
      
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

      return c.json({ text: replyText });
    } catch (error) {
      console.error('Chat endpoint error:', error);
      return c.json({ error: 'Invalid request or internal error' }, 400);
    }
  }
);

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchApi } from '../../lib/apiClient';

const chatResponseSchema = z.object({
  text: z.string(),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

export interface ChatMessage {
  text: string;
  sender: 'user' | 'bot';
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export async function submitChat(payload: ChatRequest): Promise<ChatResponse> {
  const result = await fetchApi('/api/chat', chatResponseSchema, {
    method: 'POST',
    body: payload,
  });
  
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useChat() {
  return useMutation<ChatResponse, Error, ChatRequest>({
    mutationFn: submitChat,
  });
}

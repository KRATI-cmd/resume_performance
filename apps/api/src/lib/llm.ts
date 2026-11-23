import OpenAI from 'openai';
import { env } from '../config/env';

/** Chat/completions client — OpenRouter, Ollama, or OpenAI via LLM_BASE_URL. */
export const chatClient = new OpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
  timeout: env.LLM_TIMEOUT_MS,
  maxRetries: 2,
});

/** Embedding client — falls back to the chat endpoint/key when not configured separately. */
export const embeddingClient = new OpenAI({
  baseURL: env.EMBEDDING_BASE_URL ?? env.LLM_BASE_URL,
  apiKey: env.EMBEDDING_API_KEY ?? env.LLM_API_KEY,
  timeout: env.LLM_TIMEOUT_MS,
  maxRetries: 2,
});

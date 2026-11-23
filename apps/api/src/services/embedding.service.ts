import { env, VECTOR_DIMENSIONS } from '../config/env';
import { embeddingClient } from '../lib/llm';
import { AppError } from '../lib/errors';

const BATCH_SIZE = 64;
/** Rough guard (~8k tokens) so one giant JD cannot blow the embedding model's context window. */
const MAX_INPUT_CHARS = 24_000;

export type EmbeddingResult = { vectors: number[][]; tokens: number };

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (env.EMBEDDING_DIMENSIONS !== VECTOR_DIMENSIONS) {
    throw new AppError(
      500,
      `EMBEDDING_DIMENSIONS (${env.EMBEDDING_DIMENSIONS}) must equal the database vector size (${VECTOR_DIMENSIONS})`,
      'EMBEDDING_CONFIG',
    );
  }

  const vectors: number[][] = [];
  let tokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, MAX_INPUT_CHARS));
    const res = await embeddingClient.embeddings.create({
      model: env.EMBEDDING_MODEL,
      input: batch,
      encoding_format: 'float',
    });

    if (res.data.length !== batch.length) {
      throw new AppError(502, 'Embedding provider returned an unexpected number of vectors', 'EMBEDDING_MISMATCH');
    }

    // Providers are expected to return items in order, but sort by index to be safe.
    const ordered = [...res.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) {
      if (item.embedding.length !== VECTOR_DIMENSIONS) {
        throw new AppError(
          502,
          `Embedding model "${env.EMBEDDING_MODEL}" returned ${item.embedding.length} dimensions; expected ${VECTOR_DIMENSIONS}`,
          'EMBEDDING_DIMENSIONS',
        );
      }
      vectors.push(item.embedding);
    }
    tokens += res.usage?.total_tokens ?? 0;
  }

  return { vectors, tokens };
}

export async function embedText(text: string): Promise<{ vector: number[]; tokens: number }> {
  const { vectors, tokens } = await embedTexts([text]);
  const vector = vectors[0];
  if (!vector) throw new AppError(502, 'Embedding provider returned no vector', 'EMBEDDING_EMPTY');
  return { vector, tokens };
}

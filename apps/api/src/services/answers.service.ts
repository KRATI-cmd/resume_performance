import { prisma } from '../lib/prisma';
import { isSensitiveKey } from '../schemas/http.schema';

export type AnswerInput = { key: string; label: string; value: string };

/** Upserts by (userId, key). Sensitive keys are refused; the last duplicate in a request wins. */
export async function upsertAnswers(
  userId: string,
  answers: AnswerInput[],
): Promise<{ saved: number; refused: number }> {
  const allowed = answers.filter((a) => !isSensitiveKey(a.key));
  const byKey = new Map(allowed.map((a) => [a.key, a]));
  if (byKey.size > 0) {
    await prisma.$transaction(
      [...byKey.values()].map((a) =>
        prisma.formAnswer.upsert({
          where: { userId_key: { userId, key: a.key } },
          create: { userId, key: a.key, label: a.label, value: a.value },
          update: { label: a.label, value: a.value },
        }),
      ),
    );
  }
  return { saved: byKey.size, refused: answers.length - allowed.length };
}

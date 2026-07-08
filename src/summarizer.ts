import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";

const SYSTEM_PROMPT = `あなたは Discord 通話の書記です。
入力は通話の文字起こしで、上から下へ時系列に並んでいます。
最後に話されている話題を 1 つだけ選び、その中身を日本語 1 行 (全角 40 文字以内) にまとめて summary に入れてください。
途中で話題が変わっている場合、過去の話題には触れないでください。`;

// 思考過程や前置きが混入しないよう、JSON schema で出力を summary だけに縛る
const Summary = z.object({ summary: z.string() });

export interface SummarizerOptions {
  baseURL: string;
  model: string;
}

export interface Summarizer {
  summarize: (transcript: string) => Promise<string>;
}

/** LM Studio に文字起こしを投げて、直近の話題を 1 行に要約する。 */
export const createSummarizer = ({ baseURL, model }: SummarizerOptions): Summarizer => {
  const provider = createOpenAICompatible({
    name: "lmstudio",
    baseURL,
    supportsStructuredOutputs: true,
  });
  const chatModel = provider(model);

  return {
    summarize: async (transcript) => {
      const { object } = await generateObject({
        model: chatModel,
        system: SYSTEM_PROMPT,
        prompt: transcript,
        schema: Summary,
        // thinking を切る (速度優先。要約タスクに推論は不要)
        providerOptions: { lmstudio: { reasoningEffort: "none" } },
      });
      return object.summary.trim();
    },
  };
};

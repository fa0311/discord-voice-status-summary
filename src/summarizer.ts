import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const SYSTEM_PROMPT = `あなたは Discord 通話の書記です。
通話の文字起こしを読み、いま話されている話題を日本語で 1 行に要約してください。
全角 40 文字以内で、要約の本文だけを出力してください。`;

export interface SummarizerOptions {
  baseURL: string;
  model: string;
}

export interface Summarizer {
  summarize: (transcript: string) => Promise<string>;
}

/** LM Studio に文字起こしを投げて 1 行要約する。 */
export const createSummarizer = ({ baseURL, model }: SummarizerOptions): Summarizer => {
  const provider = createOpenAICompatible({ name: "lmstudio", baseURL });
  const chatModel = provider(model);

  return {
    summarize: async (transcript) => {
      const { text } = await generateText({
        model: chatModel,
        system: SYSTEM_PROMPT,
        prompt: transcript,
        // thinking を切る (速度優先。要約タスクに推論は不要)
        providerOptions: { lmstudio: { reasoningEffort: "none" } },
      });
      // LLM が付ける末尾の改行などはここで落とす (「1 行の要約」が契約のため)
      return text.trim();
    },
  };
};

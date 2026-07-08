import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe } from "ai";

export interface TranscriberOptions {
  baseURL: string;
  model: string;
  language: string;
}

export interface Transcriber {
  transcribe: (wav: Buffer) => Promise<string>;
}

/** OpenAI 互換の文字起こしサーバに WAV を投げて文字起こしする。 */
export const createTranscriber = ({ baseURL, model, language }: TranscriberOptions): Transcriber => {
  const provider = createOpenAI({
    baseURL,
    apiKey: "not-needed",
    // VAD で無音・非音声を落とし、Whisper が無音に幻聴を起こすのを防ぐ。
    // AI SDK が送るフィールドは固定リストで vad_filter を渡せないため、送信直前に差し込む
    fetch: (input, init) => {
      if (init?.body instanceof FormData) init.body.append("vad_filter", "true");
      return fetch(input, init);
    },
  });
  const transcriptionModel = provider.transcription(model);

  return {
    transcribe: async (wav) => {
      const result = await experimental_transcribe({
        model: transcriptionModel,
        audio: wav,
        providerOptions: { openai: { language } },
      }).catch((error: unknown) => {
        // VAD が「発話なし」と判定すると AI SDK は空の結果をエラーとして投げるので、空文字に読み替える
        if (error instanceof Error && error.name === "AI_NoTranscriptGeneratedError") return null;
        throw error;
      });
      // Whisper がトークナイズの都合で付ける前後の空白はここで落とす
      return result?.text.trim() ?? "";
    },
  };
};

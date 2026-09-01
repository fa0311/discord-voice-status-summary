import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe } from "ai";

// Whisper が無音・非音声に対して出しがちな定型の幻聴フレーズ。
const HALLUCINATIONS = new Set([
  "最後までご視聴ありがとうございました",
  "ご視聴ありがとうございました",
  "ご視聴ありがとうございます",
  "ご清聴ありがとうございました",
  "チャンネル登録お願いします",
  "お疲れ様でした",
  "おやすみなさい",
  "ありがとうございました",
  "よろしくお願いいたします",
  "おわり",
]);

// 本物の発話を削らないよう、発話全体が完全一致したときだけ幻聴とみなす (末尾の句点は無視)
const isHallucination = (text: string): boolean => HALLUCINATIONS.has(text.replace(/。$/, ""));

// 文字起こしサーバが応答しないまま WAV を掴み続けるのを防ぐ。
// GPU を他のコンテナと共有しており、競合すると応答が返らないことがある。
// AI SDK のリトライも含めた 1 回の文字起こし全体に対する上限
const TRANSCRIBE_TIMEOUT_MS = 60_000;

export interface TranscriberOptions {
  baseURL: string;
  model: string;
  language: string;
  vad_filter: boolean;
  prompt: string | undefined;
  hotwords: string | undefined;
}

export interface Transcriber {
  transcribe: (wav: Buffer) => Promise<string>;
}

/** OpenAI 互換の文字起こしサーバに WAV を投げて文字起こしする。 */
export const createTranscriber = ({
  baseURL,
  model,
  language,
  vad_filter,
  prompt,
  hotwords,
}: TranscriberOptions): Transcriber => {
  const provider = createOpenAI({
    baseURL,
    apiKey: "not-needed",
    // VAD で無音・非音声を落とし、Whisper が無音に幻聴を起こすのを防ぐ。
    // AI SDK が送るフィールドは固定リストで vad_filter を渡せないため、送信直前に差し込む
    fetch: (input, init) => {
      if (init?.body instanceof FormData) {
        init.body.append("vad_filter", vad_filter ? "true" : "false");
        if (prompt) init.body.append("prompt", prompt);
        if (hotwords) init.body.append("hotwords", hotwords);
      }
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
        abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      }).catch((error: unknown) => {
        // VAD が「発話なし」と判定すると AI SDK は空の結果をエラーとして投げるので、空文字に読み替える
        if (error instanceof Error && error.name === "AI_NoTranscriptGeneratedError") return null;
        throw error;
      });
      // Whisper がトークナイズの都合で付ける前後の空白を落とし、発話全体が幻聴フレーズなら捨てる
      const text = (result?.text ?? "").trim();
      return isHallucination(text) ? "" : text;
    },
  };
};

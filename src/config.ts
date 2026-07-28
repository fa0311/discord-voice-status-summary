import { z } from "zod";

const Env = z.object({
  // Discord bot のトークン
  DISCORD_TOKEN: z.string().min(1),

  // 文字起こしサーバ (speaches など OpenAI 互換 API) の /v1 まで含めた URL
  TRANSCRIPTION_BASE_URL: z.url(),
  TRANSCRIPTION_MODEL: z.string().min(1),
  TRANSCRIPTION_LANGUAGE: z.string().min(1).default("ja"),
  TRANSCRIPTION_VAD_FILTER: z.coerce.boolean().default(true),
  TRANSCRIPTION_PROMPT: z.string().min(1).optional(),
  TRANSCRIPTION_HOTWORDS: z.string().min(1).optional(),

  // LM Studio の /v1 まで含めた URL
  LLM_BASE_URL: z.url(),
  LLM_MODEL: z.string().min(1),

  // 要約してステータスを更新する間隔
  SUMMARY_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  // 直近の発話だけを要約対象にするため、文字起こしを溜めすぎないようにする
  MAX_TRANSCRIPT_LINES: z.coerce.number().int().positive().default(50),
});

export type Config = z.infer<typeof Env>;

export const loadConfig = (env: Record<string, string | undefined>): Config => Env.parse(env);

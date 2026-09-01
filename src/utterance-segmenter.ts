import { EventEmitter } from "node:events";
import opus from "@discordjs/opus";

// CommonJS モジュールなので named import できない
const { OpusEncoder } = opus;

// Whisper は入力を 16kHz モノラルに落として処理するため、それ以上の解像度で持つ意味がない。
// libopus は Discord の 48kHz ステレオ Opus をこの形式へ直接デコードできる
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * 2;

// 音声パケットがこれだけ途切れたら発話の切れ目とみなす
const SILENCE_MS = 800;
// これより短い発話はノイズとみなして捨てる
const MIN_PCM_BYTES = BYTES_PER_SECOND * 0.5;
// これより長い発話は異常 (マイクが開いたままで環境音を送り続けている等) とみなして捨てる。
// 通常の会話で 800ms の間が一度も空かずにこの長さに達することはない
const MAX_PCM_BYTES = BYTES_PER_SECOND * 30;
// Discord が送信停止の直前に送る無音マーカー。発話には含めず、切れ目のタイマーも延長しない
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

export type DropReason = "too-short" | "too-long";

export interface SegmenterEvents {
  /** 発話が 1 つ確定した。 */
  utterance: [wav: Buffer];
  /** 発話を方針により捨てた。 */
  dropped: [reason: DropReason];
  /** デコードに失敗した。そのパケットだけ読み飛ばす。 */
  error: [error: Error];
}

/** 16bit PCM のチャンク列に WAV ヘッダを付けて 1 つの Buffer にする。 */
const pcmToWav = (chunks: Buffer[], pcmBytes: number): Buffer => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt チャンクサイズ
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28); // バイトレート
  header.writeUInt16LE(CHANNELS * 2, 32); // ブロックアライン
  header.writeUInt16LE(16, 34); // ビット深度
  header.write("data", 36);
  header.writeUInt32LE(pcmBytes, 40);
  return Buffer.concat([header, ...chunks], header.length + pcmBytes);
};

/**
 * 1 ユーザーの Opus パケット列を発話単位に区切り、WAV にしてイベントで流す。
 * 発話の切れ目は無音、長さの下限・上限はここで判定し、捨てた場合は理由を流す。
 */
export const createSegmenter = () => {
  const emitter = new EventEmitter<SegmenterEvents>();
  const decoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
  let chunks: Buffer[] = [];
  let pcmBytes = 0;
  let overflowed = false; // 上限超過で捨てた発話の残りを読み飛ばしている
  let silenceTimer: NodeJS.Timeout | undefined;

  const decode = (packet: Buffer) => {
    try {
      return decoder.decode(packet);
    } catch (error) {
      emitter.emit("error", error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
  };

  const reset = () => {
    chunks = [];
    pcmBytes = 0;
    overflowed = false;
    silenceTimer = undefined;
  };

  const flush = () => {
    if (!overflowed && pcmBytes > 0) {
      if (pcmBytes < MIN_PCM_BYTES) emitter.emit("dropped", "too-short");
      else emitter.emit("utterance", pcmToWav(chunks, pcmBytes));
    }
    reset();
  };

  /** 受信した Opus パケットを 1 つ渡す。 */
  const push = (packet: Buffer) => {
    if (packet.equals(SILENCE_FRAME)) return;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(flush, SILENCE_MS);
    if (overflowed) return;

    const pcm = decode(packet);
    if (!pcm) return;
    pcmBytes += pcm.length;
    if (pcmBytes > MAX_PCM_BYTES) {
      overflowed = true;
      chunks = [];
      emitter.emit("dropped", "too-long");
      return;
    }
    chunks.push(pcm);
  };

  /** 溜めている途中の音声を捨てて止める。 */
  const dispose = () => {
    clearTimeout(silenceTimer);
    reset();
  };

  return { emitter, push, dispose };
};

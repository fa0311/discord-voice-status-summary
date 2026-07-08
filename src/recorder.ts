import { EndBehaviorType, type VoiceReceiver } from "@discordjs/voice";
import prism from "prism-media";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
// 0.5 秒未満の発話はノイズとみなして捨てる
const MIN_PCM_BYTES = SAMPLE_RATE * CHANNELS * 2 * 0.5;
// Discord が発話の切れ目に送る無音フレーム。Opus データではないのでデコーダに通すと壊れる
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

/** 16bit PCM に WAV ヘッダを付ける。 */
const pcmToWav = (pcm: Buffer): Buffer => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt チャンクサイズ
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28); // バイトレート
  header.writeUInt16LE(CHANNELS * 2, 32); // ブロックアライン
  header.writeUInt16LE(16, 34); // ビット深度
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/**
 * ユーザーの 1 回の発話を録音し、無音 800ms で区切って WAV で返す。
 * 短すぎる発話はノイズとみなして null を返す。
 */
export const recordUtterance = (receiver: VoiceReceiver, userId: string): Promise<Buffer | null> =>
  new Promise((resolve, reject) => {
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
    });
    const decoder = new prism.opus.Decoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: 960,
    });

    const chunks: Buffer[] = [];
    decoder.on("data", (chunk: Buffer) => chunks.push(chunk));
    decoder.on("end", () => {
      const pcm = Buffer.concat(chunks);
      resolve(pcm.length >= MIN_PCM_BYTES ? pcmToWav(pcm) : null);
    });
    opusStream.on("error", reject);
    decoder.on("error", reject);

    opusStream.on("data", (packet: Buffer) => {
      if (!packet.equals(SILENCE_FRAME)) decoder.write(packet);
    });
    opusStream.on("end", () => decoder.end());
  });

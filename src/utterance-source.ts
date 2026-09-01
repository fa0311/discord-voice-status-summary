import { EventEmitter } from "node:events";
import { type AudioReceiveStream, EndBehaviorType, type VoiceReceiver, type VoiceUserData } from "@discordjs/voice";
import { createSegmenter, type DropReason } from "./utterance-segmenter.ts";

export interface UtteranceSourceEvents {
  /** ユーザーの発話が 1 つ確定した。 */
  utterance: [userId: string, wav: Buffer];
  /** 発話を方針により捨てた。 */
  dropped: [userId: string, reason: DropReason];
  /**
   * 受信・デコードに失敗した。そのユーザーの購読は続く。
   * captureRejections 経由でリスナーの reject が届く場合は userId が付かない
   */
  error: [error: Error, userId?: string];
}

/**
 * VoiceReceiver の受信を「発話」単位のイベントに変える。
 *
 * receiver.speaking の start は発話ではなく「100ms 以上空いた後の最初のパケット」ごとに発火するので、
 * ここでは未購読ユーザーの発見にだけ使い、購読自体はユーザーごとに 1 本だけ持ち続ける。
 * 発話の切れ目や長さの判定は Segmenter に任せる。
 */
export const createUtteranceSource = (receiver: VoiceReceiver) => {
  const emitter = new EventEmitter<UtteranceSourceEvents>();
  const streams = new Map<string, AudioReceiveStream>();

  const subscribe = (userId: string) => {
    if (streams.has(userId)) return;

    // Manual: 無音で終わらせず、自分で destroy するまで全パケットを受け取り続ける
    const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    const segmenter = createSegmenter();
    segmenter.emitter.on("utterance", (wav) => emitter.emit("utterance", userId, wav));
    segmenter.emitter.on("dropped", (reason) => emitter.emit("dropped", userId, reason));
    segmenter.emitter.on("error", (error) => emitter.emit("error", error, userId));
    stream.on("data", segmenter.push);
    stream.on("error", (error) => emitter.emit("error", error, userId));
    // 自分で destroy した場合も、接続の破棄で receiver 側から destroy された場合もここに来る
    stream.once("close", () => {
      segmenter.dispose();
      streams.delete(userId);
    });
    streams.set(userId, stream);
  };

  // ユーザーが通話から抜けると receiver が SSRC の対応を消すので、それに合わせて購読も捨てる
  const unsubscribe = ({ userId }: VoiceUserData) => {
    streams.get(userId)?.destroy();
  };

  receiver.speaking.on("start", subscribe);
  receiver.ssrcMap.on("delete", unsubscribe);

  return {
    emitter,
    /** 全ユーザーの購読を破棄し、以後のイベントを止める。 */
    close: () => {
      receiver.speaking.off("start", subscribe);
      receiver.ssrcMap.off("delete", unsubscribe);
      for (const stream of streams.values()) stream.destroy();
    },
  };
};

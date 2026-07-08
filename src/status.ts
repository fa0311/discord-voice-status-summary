import type { Client } from "discord.js";

// ボイスチャンネルのステータスの上限文字数
const MAX_STATUS_LENGTH = 500;

/** ボイスチャンネルのステータスを更新する。空文字でクリア。 */
export const setVoiceStatus = async (client: Client, channelId: string, status: string): Promise<void> => {
  await client.rest.put(`/channels/${channelId}/voice-status`, {
    body: { status: status.slice(0, MAX_STATUS_LENGTH) },
  });
};

import { EventEmitter } from "node:events";
import { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } from "@discordjs/voice";
import { type ChatInputCommandInteraction, Client, Events, GatewayIntentBits, SlashCommandBuilder } from "discord.js";
import { loadConfig } from "./config.ts";
import { setVoiceStatus } from "./status.ts";
import { createSummarizer } from "./summarizer.ts";
import { createTranscriber } from "./transcriber.ts";
import { createUtteranceSource } from "./utterance-source.ts";

// 非同期リスナーの reject を各 EventEmitter の error イベントに集約する
EventEmitter.captureRejections = true;

const config = loadConfig(process.env);

const { transcribe } = createTranscriber({
  baseURL: config.TRANSCRIPTION_BASE_URL,
  model: config.TRANSCRIPTION_MODEL,
  language: config.TRANSCRIPTION_LANGUAGE,
  vad_filter: config.TRANSCRIPTION_VAD_FILTER,
  prompt: config.TRANSCRIPTION_PROMPT,
  hotwords: config.TRANSCRIPTION_HOTWORDS,
});
const { summarize } = createSummarizer({
  baseURL: config.LLM_BASE_URL,
  model: config.LLM_MODEL,
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const join = async (interaction: ChatInputCommandInteraction<"cached">): Promise<void> => {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("先にボイスチャンネルに参加してください。");
    return;
  }
  if (getVoiceConnection(interaction.guildId)) {
    await interaction.reply("すでに参加しています。/leave してからやり直してください。");
    return;
  }

  const connection = joinVoiceChannel({
    guildId: channel.guild.id,
    channelId: channel.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  // セッションの状態はこのクロージャに閉じる
  const transcript: string[] = [];
  let dirty = false; // 前回の要約以降に新しい発話があるか

  const timer = setInterval(async () => {
    try {
      if (!dirty) return;
      dirty = false;
      const summary = await summarize(transcript.join("\n"));
      await setVoiceStatus(client, channel.id, summary);
      console.log(`status updated: ${summary}`);
    } catch (e) {
      console.error("summarize error:", e);
    }
  }, config.SUMMARY_INTERVAL_MS);

  const displayName = (userId: string) => channel.guild.members.cache.get(userId)?.displayName ?? "unknown";

  const utterances = createUtteranceSource(connection.receiver);
  // 発話が確定するたびに 文字起こし → transcript へ追記
  utterances.emitter.on("utterance", async (userId, wav) => {
    const text = await transcribe(wav);
    if (!text) return;
    const name = displayName(userId);
    console.log(`transcribed: ${name}: ${text}`);
    transcript.push(`${name}: ${text}`);
    transcript.splice(0, transcript.length - config.MAX_TRANSCRIPT_LINES);
    dirty = true;
  });
  // 短すぎる発話は日常的なノイズなので黙って捨てる。長すぎる発話はマイク設定の問題なので誰のものか残す
  utterances.emitter.on("dropped", (userId, reason) => {
    if (reason === "too-long") console.warn(`utterance dropped (${reason}): ${displayName(userId)}`);
  });
  // 文字起こし (utterance リスナー) の reject も captureRejections でここに届く
  utterances.emitter.on("error", (error, userId) =>
    console.error(`utterance error (${userId ? displayName(userId) : "-"}):`, error),
  );

  // /leave (destroy) で購読とタイマーを止めてステータスを消す
  connection.on(VoiceConnectionStatus.Destroyed, async () => {
    utterances.close();
    clearInterval(timer);
    await setVoiceStatus(client, channel.id, "");
  });
  connection.on("error", (error) => console.error("connection error:", error));

  console.log(`joined: ${channel.guild.name} / ${channel.name}`);
  await interaction.reply(`${channel.name} の要約を始めます。`);
};

const leave = async (interaction: ChatInputCommandInteraction<"cached">): Promise<void> => {
  getVoiceConnection(interaction.guildId)?.destroy();
  await interaction.reply("退出しました。");
};

client.once(Events.ClientReady, async (readyClient) => {
  await readyClient.application.commands.set([
    new SlashCommandBuilder().setName("join").setDescription("ボイスチャンネルに参加して要約を始める"),
    new SlashCommandBuilder().setName("leave").setDescription("ボイスチャンネルから退出する"),
  ]);
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  if (interaction.commandName === "join") await join(interaction);
  if (interaction.commandName === "leave") await leave(interaction);
});

// captureRejections で集約されたエラーもここに届く
client.on(Events.Error, (error) => console.error(error));

await client.login(config.DISCORD_TOKEN);

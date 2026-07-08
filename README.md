# discord-voice-status-summary

Discord の通話内容を要約して、ボイスチャンネルのステータスに反映する bot (PoC)。

```
Discord 通話 ─(音声)→ bot ─(WAV)→ 文字起こしサーバ (speaches)
                        │
                        └─(文字起こし)→ LM Studio ─(要約)→ VC ステータス
```

- bot: このリポジトリ。TypeScript + discord.js + [AI SDK](https://ai-sdk.dev/)
- 文字起こし: [speaches](https://github.com/speaches-ai/speaches) (OpenAI 互換 API を持つ既存イメージ。AI SDK の `experimental_transcribe` をそのまま向けられるため自作しない)
- LLM: LM Studio (公式コンテナが無いため別ホストで起動し、URL で接続)

speaches と LM Studio は別ホストでも良い。speaches を NVIDIA GPU で建てる compose の例
(ホスト側に [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) が必要):

```yaml
services:
  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cuda
    ports:
      - "4560:8000"
    volumes:
      - hf-hub-cache:/home/ubuntu/.cache/huggingface/hub
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  hf-hub-cache:
```

## 動かし方

1. [Discord Developer Portal](https://discord.com/developers/applications) で bot を作り、トークンを取得する
   - 招待時のスコープ: `bot` `applications.commands`、権限: `Connect` と `Set Voice Channel Status`
2. LM Studio でモデルをロードしてサーバを起動する (`lms server start`)
3. `.env` を用意する

   ```sh
   cp .env.example .env  # DISCORD_TOKEN と各サーバの URL・モデル名を埋める
   ```

4. 起動する

   ```sh
   docker compose up
   ```

5. ボイスチャンネルに入って `/join` すると、以降 `SUMMARY_INTERVAL_MS` ごとに要約がステータスに反映される。`/leave` で退出・ステータスをクリア

## 環境変数

すべて起動時に zod でバリデーションされる ([src/config.ts](src/config.ts))。

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `DISCORD_TOKEN` | Discord bot のトークン | (必須) |
| `TRANSCRIPTION_BASE_URL` | 文字起こしサーバの URL (`/v1` まで) | (必須) |
| `TRANSCRIPTION_MODEL` | 文字起こしモデル | (必須) |
| `TRANSCRIPTION_LANGUAGE` | 文字起こしの言語 | `ja` |
| `LLM_BASE_URL` | LM Studio の URL (`/v1` まで) | (必須) |
| `LLM_MODEL` | 要約に使うモデル | (必須) |
| `SUMMARY_INTERVAL_MS` | ステータス更新間隔 (ミリ秒) | `60000` |

## 開発

```sh
pnpm install
pnpm dev    # tsx で起動
pnpm build  # dist/ に出力
```

## 配布

`main` に push すると GitHub Actions が Docker イメージをビルドし、
`ghcr.io/<owner>/discord-voice-status-summary:latest` として公開する
([.github/workflows/docker.yml](.github/workflows/docker.yml))。

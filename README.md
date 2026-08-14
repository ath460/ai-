# ONYX AI社員

営業・マーケティング・事務を、AI社員が24時間自動で回す運用エンジンと、スマホ専用のダッシュボード。

店長がやることは、朝スマホを開いて**外部に出るものだけ承認する**こと。それ以外は寝ている間に終わっている。

---

## 何が動くのか

| | |
|---|---|
| **AI社員 3名** | 営業（一次対応）／マーケティング（発信）／事務（掲載・集計） |
| **自動稼働** | cron で定義した時刻に自動起動。深夜の問い合わせにもその場で下書きが用意される |
| **承認フロー** | 社内作業は全自動。外部に出るもの（メール・SNS・掲載更新・予定登録）だけスマホで1タップ承認 |
| **スマホ専用画面** | 稼働ログ／承認待ち／AI社員別／日報。PWA なのでホーム画面に置ける |
| **マルチテナント** | 店舗ごとにデータ・文体・接続先を分離。クライアント提供を前提にした構造 |

### 承認フローの設計

外部発信を止めているのはプロンプトではなく、**ツールの設計**です。

AI社員が持っているのは `draft_email` / `draft_social_post` / `draft_calendar_event` /
`draft_listing_update` の4つだけで、**送信するツールを渡していません**。
プロンプトが破られても、AI社員が単独で外部に何かを出すことは構造上できません。

```
AI社員 ──→ draft_*  ──→ 承認キュー ──→ 【店長がスマホでタップ】──→ コネクタ ──→ 外部
                            ↑                                            (Gmail / SNS / 掲載)
                       ここで必ず止まる
```

却下するときに書いた理由は、次回そのAI社員のプロンプトに渡ります。同じ直しを二度言わずに済みます。

---

## 動かす

必要なのは **Node.js 22.5 以上**だけです（DB は Node 同梱の SQLite。ネイティブビルド不要）。

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY を入れる
npm run db:seed           # デモ店舗・AI社員3名・定期ジョブ6件を投入

npm run dev               # → http://localhost:3000（スマホ表示で開く）
npm run tick -- --all     # AI社員を1回まとめて動かす
npm run worker            # 24時間の自動稼働を開始
```

`GOOGLE_*` を設定しなくても全機能が動きます（Gmail・カレンダーはモックデータ）。
画面の「接続状況」に**未接続**と出るので、モックで動いているのか本番接続なのかは常に見えます。

### コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | ダッシュボード（開発） |
| `npm run build` / `npm start` | 本番ビルド・起動 |
| `npm run db:seed` | デモデータ投入（既存テナントがあれば何もしない） |
| `npm run worker` | 常駐ワーカー。毎分ジョブを確認して実行 |
| `npm run tick` | 今この分に該当するジョブだけ実行（本番と同じ挙動） |
| `npm run tick -- --all` | cron を無視して全ジョブを1回実行（動作確認用） |
| `npm run typecheck` | 型検査 |

---

## 本番接続

### Gmail / Google カレンダー

1. Google Cloud Console で OAuth クライアント（デスクトップ）を作成
2. スコープ `gmail.modify` と `calendar.events` で同意画面を通す
3. `.env` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` を設定

複数店舗を運用する場合、リフレッシュトークンは店舗ごとに `connector_accounts` テーブルへ保存します
（`.env` の `GOOGLE_REFRESH_TOKEN` は単一店舗運用のときの代用です）。

**認証情報はコンテナに入りません。** Gmail の送信は `src/lib/connectors/google.ts` の中だけで行われ、
AI社員が読み書きできるのは下書きの中身だけです。

### SNS / MEO

`src/lib/connectors/mock.ts` の `createMockSocialConnector` / `createMockListingConnector` を
実装に差し替えるだけです。インターフェース（`src/lib/connectors/types.ts`）は確定しているので、
AI社員エンジン側の変更は不要です。

### Vercel へのデプロイ

`vercel.json` に毎分の Cron を定義済みです。

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "* * * * *" }] }
```

**本番では `CRON_SECRET` を必ず設定してください。** 未設定だと本番環境では 401 を返します
（ローカルでは開発の利便のため通します）。

> ⚠️ Vercel はファイルシステムが読み取り専用のため、SQLite のままではデプロイできません。
> `src/lib/db/client.ts` と `src/lib/db/repo.ts` を Postgres 実装に差し替えてください。
> SQL は全て repo.ts に閉じているので、他のファイルは変更不要です。

---

## 構成

```
src/
  lib/
    types.ts              ドメイン型（DB実装に依存しない）
    db/                   SQLite 実装。SQL は repo.ts に閉じている
    connectors/           Gmail / カレンダー（実接続）、SNS / MEO（スタブ）
    agents/
      prompts.ts          職種別 system prompt と文体設計の差し込み
      tools.ts            AI社員のツール（社内=即実行 / draft_*=承認キュー）
      runner.ts           1ジョブの実行。スロット予約による冪等化
      dispatch.ts         承認済みアクションの実行（外部に出る唯一の出口）
    scheduler/            cron 評価（タイムゾーン対応）と tick
  app/                    スマホ専用 UI（Next.js App Router）
  components/
worker/index.ts           常駐ワーカー（ローカル / VPS 用）
scripts/                  migrate / seed / tick
```

詳しい設計判断は [docs/architecture.md](docs/architecture.md) を参照してください。

---

## 現状の制約

正直に書いておきます。

- **SNS・MEO は未接続。** アダプタとインターフェースだけ実装済みで、実投稿はしません。
  接続先の仕様確認が済み次第、`mock.ts` の該当関数を差し替えます。
- **認証が入っていません。** 現状は URL を知っていれば誰でも開けます。
  クライアントに配る前に、ログインとテナント選択を入れる必要があります。
  `src/app/approvals/actions.ts` の `currentActor()` がその差し込み口です。
- **日報の「削減時間」は推定値**です。「片付いた件数 × 12分」で算出しており、実測ではありません。
  画面上にも同じ但し書きを出しています。
- **UI はシングルテナント表示**です。データ構造は全テーブルが `tenant_id` を持つマルチテナントですが、
  画面は `ONYX_TENANT_ID`（未設定なら最初の1件）だけを見ます。店舗切り替え UI は未実装です。
- **AI社員の実稼働は未検証**です。開発環境に API キーが無いため、承認フロー・冪等性・
  コネクタ経由の実行までは検証済みですが、モデル呼び出しを伴う経路は動作確認していません。

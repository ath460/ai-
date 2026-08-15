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
| **費用の足切り** | やることが無い回はモデルを呼ばずに終了する。30分ごとのジョブの空振り分を丸ごと削る |

### 接続状況

| 接続先 | 状態 |
|---|---|
| Gmail | 実接続（受信・送信） |
| Google カレンダー | 実接続（取得・登録） |
| **Instagram** | **実接続（Meta Graph API で実投稿）** |
| X | アダプタのみ |
| MEO / 掲載媒体 | アダプタのみ |

いずれも認証情報が未設定ならモックで動きます。画面の「接続状況」に実接続かモックかが出ます。

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
| `npm run db:migrate` | スキーマ適用（何度実行しても安全） |
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

### Instagram

**前提**: Instagram をプロアカウント（ビジネス）にし、Facebook ページと連携していること。
Meta 開発者アプリで `instagram_basic` と `instagram_content_publish` の権限を取得済みであること。

1. Meta for Developers でアプリを作成し、Instagram Graph API を追加
2. 短期トークンを**長期トークン（60日）**に交換
3. `GET /me/accounts` → `GET /{page-id}?fields=instagram_business_account` で
   Instagram プロアカウントのID（数値）を取得
4. `.env` に `INSTAGRAM_ACCESS_TOKEN` と `INSTAGRAM_IG_USER_ID` を設定

**知っておくべき制約**（実装はこれらを前提にしています）:

- **テキストのみの投稿はできません。** 画像が必ず要ります
- 画像は **Meta 側が取りに行く**ため、公開された https URL でなければなりません。
  バイト列の直接アップロードは不可、ローカルファイルも署名付きの短命URLも使えません
- **予約投稿の API はありません。** 承認した時点で公開されます
  （`scheduledFor` は記録と表示にのみ使い、その旨を実行結果に明記します）
- 長期トークンは **60日で失効**します。更新の運用が要ります
- Graph API のバージョンは `INSTAGRAM_GRAPH_VERSION` で差し替え可能（既定 `v25.0`）

#### 写真ライブラリ

Instagram が画像必須なので、AI社員が画像URLを捏造できないよう
**登録済みの写真からしか選べない**構造にしています。

- `media_assets` テーブルに店舗の写真（公開URL＋説明＋タグ）を登録
- AI社員は `list_media` ツールで一覧・検索し、そこから選ぶ
- 未登録のURLが下書きに混ざった場合、承認キューに積まれる前に弾かれる

シードにはダミー画像（`picsum.photos`）が5件入っています。**実運用では店舗の実写真に
差し替えてください。**

### X / MEO

`src/lib/connectors/mock.ts` の `createMockSocialConnector` / `createMockListingConnector` を
実装に差し替えるだけです。インターフェース（`src/lib/connectors/types.ts`）は確定しているので、
AI社員エンジン側の変更は不要です。SNS はプラットフォーム別のルーティングを
`src/lib/connectors/index.ts` の `createRoutedSocialConnector` で行っています。

### 24時間動かす（デプロイ）

**推奨は Render** です。`render.yaml` を同梱してあるので、Blueprint でリポジトリを指すだけで
Web・ワーカー・Postgres の3つが立ち上がります。マルチテナントなので、**クライアント店舗が
何件増えてもデプロイは1つのまま**です。

DB は `DATABASE_URL` の有無で切り替わります。**コードの変更は要りません。**

| 環境 | DB | 設定 |
|---|---|---|
| **Render（推奨）** | Postgres | **`render.yaml` 同梱。Blueprint を指すだけ** |
| VPS 1台 | SQLite | `DATABASE_URL` 未設定のまま |
| Vercel | Postgres 必須 | `DATABASE_URL` + `CRON_SECRET` |

Render で押さえておくこと: **ワーカーに無料プランはありません**（唯一の必須課金）。
**無料 Postgres は30日でデータが消える**ので、Apply 後に有料プランへ変更してください。
Web は無料のままで構いません（スリープしてもワーカーは別サービスなので稼働は止まりません）。

**VPS 1台**は、自分の1店舗だけを回す場合の選択肢です。SQLite のまま無改造で載り、
月600〜900円で済みます。ただしサーバー管理は自分で持つことになります。

Vercel は**常駐ワーカーを置けない**ため `vercel.json` の Cron 経由になります。
Cron の最短実行間隔と関数の最大実行時間はプランで変わるので、事前に確認してください。
**本番では `CRON_SECRET` を必ず設定してください**（未設定だと本番では 401 を返します）。

Render の手順、systemd の設定、HTTPS と認証、バックアップ、**費用の見積もり**は
[docs/deploy.md](docs/deploy.md) にまとめています。

---

## 構成

```
src/
  lib/
    types.ts              ドメイン型（DB実装に依存しない）
    db/                   driver.ts / sqlite.ts / postgres.ts / repo.ts
                          SQL は repo.ts に閉じ、方言差はドライバ層が吸収する
    connectors/           Gmail / カレンダー（実接続）、SNS / MEO（スタブ）
    agents/
      prompts.ts          職種別 system prompt と文体設計の差し込み
      tools.ts            AI社員のツール（社内=即実行 / draft_*=承認キュー）
      runner.ts           1ジョブの実行。スロット予約による冪等化
      precheck.ts         モデルを呼ぶ前の足切り（費用の大半を決める）
      dispatch.ts         承認済みアクションの実行（外部に出る唯一の出口）
    scheduler/            cron 評価（タイムゾーン対応）と tick
  app/                    スマホ専用 UI（Next.js App Router）
  components/
worker/index.ts           常駐ワーカー（Render / VPS / ローカル）
scripts/                  migrate / seed / tick
```

詳しい設計判断は [docs/architecture.md](docs/architecture.md) を参照してください。

---

## 現状の制約

正直に書いておきます。

- **Instagram は実通信での検証ができていません。** 開発環境から Meta のドメインへ到達できず
  （ドキュメント・API ともに egress で遮断）、公式仕様の突き合わせと実投稿の確認を
  していません。リクエストの組み立て・2段フロー・エラー処理・各種上限チェックは
  `fetch` をスタブした24項目のテストで確認済みですが、**Meta が実際に受け付けるかは未確認**です。
  本番投入前に、Graph API のバージョンと必須パラメータを公式ドキュメントで確認してください。
- **X・MEO は未接続。** アダプタとインターフェースだけ実装済みで、実投稿はしません。
- **認証が入っていません。** 現状は URL を知っていれば誰でも開けます。
  クライアントに配る前に、ログインとテナント選択を入れる必要があります。
  `src/app/approvals/actions.ts` の `currentActor()` がその差し込み口です。
- **日報の「削減時間」は推定値**です。「片付いた件数 × 12分」で算出しており、実測ではありません。
  画面上にも同じ但し書きを出しています。
- **UI はシングルテナント表示**です。データ構造は全テーブルが `tenant_id` を持つマルチテナントですが、
  画面は `ONYX_TENANT_ID`（未設定なら最初の1件）だけを見ます。店舗切り替え UI は未実装です。
- **AI社員の実稼働は未検証**です。開発環境に API キーが無いため、承認フロー・冪等性・
  事前チェック・コネクタ経由の実行までは SQLite と Postgres の両方で検証済みですが、
  モデル呼び出しを伴う経路は動作確認していません。
- **事前チェックの削減率は店舗次第**です。「新着メールが無ければ起動しない」という条件なので、
  問い合わせが多い店舗では効きが小さくなります。日報画面に実際のスキップ回数が出ます。

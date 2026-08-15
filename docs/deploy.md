# デプロイ — 24時間動かす

結論から: **Render** を推奨します。`render.yaml`（Blueprint）を同梱してあるので、
リポジトリを指すだけで Web・ワーカー・Postgres の3つが立ち上がります。

判断の理由は1つです。**マルチテナント設計なので、クライアント店舗が何件増えても
デプロイは1つのまま**です。VPS との差額は月およそ1,200円で、これは店舗ごとに
増えるコストではなく事業全体での差額です。その額のために OS 更新・TLS 更新・
バックアップ・深夜の障害対応を自分で抱える理由がありません。

**VPS のほうが良くなるケース**: 自分の1店舗だけを回す、かつサーバーを触るのが
苦でない場合です。SQLite のまま無改造で1台に載り、月600〜900円で済みます。
ただし戻ってくるのは月1,200円です。手順は[後半](#代替-vps-1台)に残してあります。

**Vercel は候補になりません**。理由は比較表の下に書きます。

---

## 選択肢の比較

| | Render（推奨） | VPS 1台 | Vercel |
|---|---|---|---|
| DB | Postgres（自動で注入） | SQLite（設定不要） | Postgres 必須 |
| 常駐ワーカー | worker サービス（**有料のみ**） | systemd で常駐 | **置けない**（Cron のみ） |
| コード変更 | 不要 | 不要 | 不要 |
| 設定ファイル | `render.yaml` 同梱 | 手で書く | `vercel.json` 同梱 |
| サーバー管理 | 不要 | 必要 | 不要 |
| 最小構成の月額 | 2,000円前後（ワーカー＋DB） | 600〜900円 | Cron の実行間隔がプラン依存 |

**Vercel を外している理由**: 常駐ワーカーを置けず Cron 経由になります。AI社員の1ジョブは
思考とツール往復で数分かかることがあり、関数の最大実行時間と Cron の最短実行間隔が
どちらもプラン依存です。`vercel.json` は同梱していますが、この用途では構造的に不利です。
選ぶ場合は契約プランでの上限を事前に確認してください（毎分実行の設定になっています）。

---

## 推奨: Render

`render.yaml`（Blueprint）をリポジトリに置いてあります。Web・ワーカー・Postgres の
3つがまとめて作られます。

### 手順

1. Render にログインし、**Blueprints → New Blueprint Instance**
2. このリポジトリを選ぶ（`render.yaml` が自動で読まれます）
3. `sync: false` の環境変数を入力する画面が出るので、少なくとも
   **`ANTHROPIC_API_KEY`** を入れる（Google と Instagram は空でもモックで動きます）
4. Apply

`DATABASE_URL` は `fromDatabase` で自動的に注入されるので、手で設定する必要はありません。
スキーマは初回アクセス時に自動で適用されます（`CREATE TABLE IF NOT EXISTS` のみ）。

### 必要なプラン — 無料のままでは運用に入れません

| サービス | `render.yaml` の既定 | 本番で必要な対応 |
|---|---|---|
| `onyx-worker` | **starter（有料）** | そのまま。**ワーカーに無料プランはありません。** ここが「寝ていても自動で」の本体です |
| `onyx-db` | free | **有料プランへ変更が必須。** 無料 Postgres はデータが30日で消えます |
| `onyx-web` | free | そのままで可。スリープしても**ワーカーは別サービスなので AI社員は動き続けます** |

`onyx-db` を `plan: free` のままにしてあるのは、**プラン名をコードに書いて Apply が
失敗するのを避けるため**です（Render の DB プラン名は改定されています）。Apply 後に
ダッシュボードの `onyx-db` → Settings から有料プランへ変更してください。
承認履歴と監査ログが入るテーブルなので、**無料のまま運用に入らないでください。**

`onyx-web` が無料プランだと、アクセスが無い間はスリープします。朝スマホで開いたときの
初回表示に数十秒かかります。承認が遅れて困るなら starter に上げてください。

### 初期データの投入

デプロイしただけでは店舗が1件も無く、画面はセットアップ案内のままです。
Render Shell（`onyx-web` サービス → Shell タブ）から実行します。

```bash
npm run db:seed
```

**シードの中身はデモ用の居酒屋です。** 実店舗で使うなら、先に `scripts/seed.ts` の
店名・文体・申し送り・写真URLを書き換えてから実行してください。

### 注意点

- **Cron ではなくワーカーを使っています。** Render には Cron Job サービスもありますが、
  常駐ワーカーのほうが1分粒度で回せて、AI社員の長い実行時間も気にせずに済みます。
- **リージョン**は `singapore`（日本から最寄り）にしてあります。変更する場合は
  Web・ワーカー・DB を揃えてください。揃っていないと DB 接続が外部経由になります。
- **認証がまだありません。** Render の URL は推測しにくいですが公開URLです。
  クライアントに渡す前にログインを実装してください。
- **`render.yaml` の記法は Render 公式では未検証です。** 開発環境から render.com へ
  到達できず（egress で遮断）、検索結果を根拠に書いています。Apply でエラーが出た場合は
  その内容に合わせて調整してください。

---

## 代替: VPS 1台

さくらのVPS / ConoHa / Xserver VPS の最小プラン（メモリ1GB）で足ります。
負荷はほぼ AI 呼び出しの待ち時間なので、CPU もメモリも要りません。
DB は SQLite のまま（`DATABASE_URL` 未設定）で動きます。

### 1. 配置

```bash
sudo mkdir -p /opt/onyx && sudo chown $USER /opt/onyx
git clone <repo> /opt/onyx && cd /opt/onyx
npm ci
cp .env.example .env   # ANTHROPIC_API_KEY を入れる
npm run build
npm run db:seed        # 初回のみ
```

Node.js は **22.5 以上**が必要です（`node:sqlite` を使うため）。

### 2. 常駐させる

Web とワーカーを別々の systemd ユニットにします。

```ini
# /etc/systemd/system/onyx-web.service
[Unit]
Description=ONYX AI社員 ダッシュボード
After=network.target

[Service]
Type=simple
User=onyx
WorkingDirectory=/opt/onyx
EnvironmentFile=/opt/onyx/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/onyx-worker.service
[Unit]
Description=ONYX AI社員 ワーカー
After=network.target

[Service]
Type=simple
User=onyx
WorkingDirectory=/opt/onyx
EnvironmentFile=/opt/onyx/.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=10
# 実行中のジョブを終わらせてから止める
KillSignal=SIGTERM
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onyx-web onyx-worker
sudo journalctl -u onyx-worker -f    # 稼働の確認
```

ワーカーは SIGTERM を受けると実行中のジョブを待ってから終了します。
`TimeoutStopSec=120` はそのための猶予です。

### 3. HTTPS と認証（必須）

**認証がまだ実装されていません。URL を知っていれば誰でも承認ボタンを押せます。**
公開する前に、最低でも Basic 認証を前段で掛けてください。

```caddyfile
# /etc/caddy/Caddyfile
onyx.example.com {
    basic_auth {
        tencho $2a$14$...   # caddy hash-password で生成
    }
    reverse_proxy localhost:3000
}
```

Caddy なら証明書は自動取得・自動更新されます。

### 4. バックアップ

SQLite は1ファイルなので、日次でコピーするだけです。
WAL モードで動いているため、稼働中のファイルを直接コピーせず `.backup` を使います。

```bash
# /etc/cron.daily/onyx-backup
sqlite3 /opt/onyx/data/onyx.sqlite ".backup '/var/backups/onyx-$(date +\%F).sqlite'"
find /var/backups -name 'onyx-*.sqlite' -mtime +30 -delete
```

承認履歴と監査ログが入っているので、取っておく価値があります。

---

## Postgres で動かす

`DATABASE_URL` を設定するだけで切り替わります。コードの変更は要りません。
Render では自動で注入されるので、この節は Railway / Neon / Supabase など
自分で接続文字列を用意する場合の話です。

```bash
DATABASE_URL=postgresql://user:pass@host:5432/onyx
npm run db:migrate   # スキーマ適用
npm run db:seed      # 初回のみ
```

- **TLS**: 接続文字列に `sslmode=` があればそれに従い、無ければ TLS を張ります
  （マネージドPostgres は概ね必須のため）。TLS 無しのローカル Postgres に繋ぐときだけ
  `PGSSL=disable` を設定してください。
- **接続数**: `PGPOOL_MAX`（既定5）は1プロセスあたりの上限です。
  サーバーレスではプロセス数を制御できないので、**プーラー付きの接続文字列**
  （Neon / Supabase の pgbouncer エンドポイント）を使ってください。

SQLite と Postgres の切り替えは `src/lib/db/client.ts` の1箇所で、
SQL は `repo.ts` に閉じています。方言差は「浮動小数の型名」と
「プレースホルダの形式」だけで、どちらもドライバ層が吸収しています。

---

## 費用の見積もり

**ホスティング代よりモデルの実行費用のほうが大きくなります。** 先に読んでください。
デプロイ先を比較して削れるのは月1,000円台ですが、こちらは桁が違います。

定期ジョブは6件で、うち「問い合わせの一次対応」は30分ごとです。
そのままだと1日48回、月1,400回以上モデルが起動します。

そのため、**モデルを呼ぶ前の足切り**を入れてあります（`src/lib/agents/precheck.ts`）。
一次対応のジョブは `precheck: "new_inbox"` が設定されていて、
前回稼働以降に新着メールが無ければ**モデルを呼ばずに終了**します。
判定に使うのは受信箱の一覧取得だけで、これは無料です。

実際の削減率は店舗の問い合わせ量に依存します。日報画面の下部に
「ほかに N 回は、やることが無いと判定して起動せず、費用が出ていません」と出るので、
1週間動かせば実測値が得られます。

さらに削りたい場合の順序:

1. 一次対応の cron を `*/30` から `0 * * * *`（1時間ごと）に落とす
2. `runner.ts` の `output_config.effort` を `high` から `medium` に下げる
3. 他のジョブにも `precheck` を足す（種別を増やす場所は `precheck.ts` の switch 1箇所）

---

## 動作確認

デプロイ後、この順で確認してください。
Render なら `onyx-web` サービスの Shell タブ、VPS なら SSH から実行します。

```bash
# 1. スキーマが入ったか
npm run db:migrate

# 2. 今この分に該当するジョブがあるか（無ければ何も起きないのが正常）
npm run tick

# 3. 全ジョブを1回ずつ動かす（費用が発生します）
npm run tick -- --all
```

ワーカーが動いているかのログは、

```bash
# Render: onyx-worker サービス → Logs タブ
# VPS:
sudo journalctl -u onyx-worker -f
```

スマホで開いて、承認待ちが並んでいれば通しで動いています。

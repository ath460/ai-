# デプロイ — 24時間動かす

結論から: **VPS 1台**を推奨します。いまの構成がそのまま、無改造で動くためです。

Postgres 対応も入っているので、Railway / Render / Vercel + マネージドPostgres という選択も取れます。
判断材料を先に置きます。

---

## 選択肢の比較

| | VPS 1台 | Render（設定済み） | Vercel |
|---|---|---|---|
| DB | SQLite（設定不要） | Postgres（自動で注入） | Postgres 必須 |
| 常駐ワーカー | systemd で常駐 | worker サービス（**有料のみ**） | **置けない**（Cron のみ） |
| コード変更 | 不要 | 不要 | 不要 |
| 設定ファイル | 手で書く | `render.yaml` 同梱 | `vercel.json` 同梱 |
| サーバー管理 | 必要 | 不要 | 不要 |
| 最小構成の月額 | 600〜900円 | ワーカー分の課金が必須 | Cron の実行間隔がプラン依存 |

**手間をかけたくないなら Render**（`render.yaml` を置いてあるので Blueprint を
指すだけ）、**費用を抑えたいなら VPS**（無改造で全部1台に載る）です。

**Vercel を選ぶ場合の注意**: Cron の最短実行間隔と関数の最大実行時間はプランで変わります。
AI社員の1ジョブは思考とツール往復で数分かかることがあるため、契約プランでの上限を
事前に確認してください（`vercel.json` は毎分実行の設定になっています）。

---

## 推奨: VPS 1台

さくらのVPS / ConoHa / Xserver VPS の最小プラン（メモリ1GB）で足ります。
負荷はほぼ AI 呼び出しの待ち時間なので、CPU もメモリも要りません。

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

## Render にデプロイする

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

### 初期データの投入

デプロイしただけでは店舗が1件も無く、画面はセットアップ案内のままです。
Render Shell（`onyx-web` サービス → Shell タブ）から実行します。

```bash
npm run db:seed
```

**シードの中身はデモ用の居酒屋です。** 実店舗で使うなら、先に `scripts/seed.ts` の
店名・文体・申し送り・写真URLを書き換えてから実行してください。

### 料金と、無料プランの落とし穴

| サービス | 既定 | 注意 |
|---|---|---|
| `onyx-worker` | **starter（有料）** | **ワーカーに無料プランはありません。** ここが唯一の必須課金です |
| `onyx-db` | free | **無料 Postgres はデータが30日で消えます。** 試用を超えたら必ず有料へ |
| `onyx-web` | free | アクセスが無いとスリープし、初回表示に数十秒かかります |

Web がスリープしても**ワーカーは別サービスなので AI社員は動き続けます**。
朝の初回表示の待ちが許容できないなら、`onyx-web` を starter に上げてください。

承認履歴と監査ログが入るため、**無料 Postgres のまま運用に入らないでください。**
`render.yaml` の `onyx-db` の `plan` を書き換えるだけです。

### 注意点

- **Cron ではなくワーカーを使っています。** Render には Cron Job サービスもありますが、
  常駐ワーカーのほうが1分粒度で回せて、AI社員の長い実行時間も気にせずに済みます。
- **リージョン**は `singapore`（日本から最寄り）にしてあります。変更する場合は
  Web・ワーカー・DB を揃えてください。揃っていないと DB 接続が外部経由になります。
- **認証がまだありません。** Render の URL は推測しにくいですが公開URLです。
  クライアントに渡す前にログインを実装してください。

---

## Postgres で動かす

`DATABASE_URL` を設定するだけで切り替わります。コードの変更は要りません。

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

```bash
# 1. スキーマが入ったか
npm run db:migrate

# 2. 今この分に該当するジョブがあるか（無ければ何も起きないのが正常）
npm run tick

# 3. 全ジョブを1回ずつ動かす（費用が発生します）
npm run tick -- --all

# 4. ワーカーのログ
sudo journalctl -u onyx-worker -f
```

スマホで開いて、承認待ちが並んでいれば通しで動いています。

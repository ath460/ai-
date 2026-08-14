# デプロイ — 24時間動かす

結論から: **VPS 1台**を推奨します。いまの構成がそのまま、無改造で動くためです。

Postgres 対応も入っているので、Railway / Render / Vercel + マネージドPostgres という選択も取れます。
判断材料を先に置きます。

---

## 選択肢の比較

| | VPS 1台（推奨） | Railway / Render | Vercel + マネージドPostgres |
|---|---|---|---|
| DB | SQLite（設定不要） | Postgres or SQLite（永続ボリューム） | Postgres 必須 |
| 常駐ワーカー | そのまま動く | 別プロセスとして動く | **置けない**（Cron のみ） |
| コード変更 | 不要 | 不要 | 不要（`DATABASE_URL` を入れるだけ） |
| 月額 | 600〜900円 | 10〜20ドル | Cron の実行間隔がプラン依存 |
| サーバー管理 | 必要 | 不要 | 不要 |

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

## Postgres で動かす

`DATABASE_URL` を設定するだけで切り替わります。コードの変更は要りません。

```bash
DATABASE_URL=postgresql://user:pass@host:5432/onyx
npm run db:migrate   # スキーマ適用
npm run db:seed      # 初回のみ
```

- **TLS**: 既定で TLS 接続します。ローカル検証で TLS 無しの Postgres に繋ぐときだけ `PGSSL=disable`。
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

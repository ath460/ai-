import { PageHeader } from "./ui";

/**
 * テナントが1件も無いときの画面。
 * 空白のダッシュボードを見せるより、次に打つコマンドを出すほうが早い。
 */
export function SetupNotice() {
  return (
    <main>
      <PageHeader eyebrow="SETUP" title="まだ店舗が登録されていません" />
      <div className="space-y-4 px-5 text-[14px] leading-relaxed">
        <p className="text-[color:var(--color-text-mute)]">
          デモ用の店舗とAI社員3名を投入すると、この画面が稼働ログに変わります。
        </p>
        <pre className="overflow-x-auto rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-stone)] p-4 font-mono text-[12px] text-[color:var(--color-gold-lt)]">
          npm run db:seed
        </pre>
        <p className="text-[color:var(--color-text-mute)]">
          そのうえで AI社員を1回動かすには次を実行します。
          <br />
          <span className="font-mono text-[12px] text-[color:var(--color-ash-2)]">
            ANTHROPIC_API_KEY
          </span>{" "}
          が設定されている必要があります。
        </p>
        <pre className="overflow-x-auto rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-stone)] p-4 font-mono text-[12px] text-[color:var(--color-gold-lt)]">
          npm run tick -- --all
        </pre>
      </div>
    </main>
  );
}

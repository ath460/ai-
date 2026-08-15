import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite と googleapis はサーバー側でのみ読み込む。
  // バンドルせず Node のネイティブ require に任せる。
  serverExternalPackages: ["googleapis"],
  experimental: {
    // AI社員の1ジョブは思考時間が長い。Server Action のタイムアウトを伸ばす。
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;

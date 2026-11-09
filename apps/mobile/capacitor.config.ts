import type { CapacitorConfig } from "@capacitor/cli";

// Live reload（票 01 dev 流程）：本机 `npm run dev` 起 vite（5173），
// 手机侧 `adb reverse tcp:5173 tcp:5173` 打通后，以
// `CAP_DEV_SERVER_URL=http://localhost:5173 npm run cap:sync` 注入；
// 未注入时 WebView 加载打包进 APK 的 dist。
const devServerUrl = process.env.CAP_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: "dev.lingualeaf.app",
  appName: "LinguaLeaf",
  webDir: "dist",
  ...(devServerUrl ? { server: { url: devServerUrl, cleartext: true } } : {}),
};

export default config;

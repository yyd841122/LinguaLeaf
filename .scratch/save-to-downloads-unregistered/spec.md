# SaveToDownloads 原生插件未注册:「保存到本机」真机必败(P1)

**Status:** needs-triage

来自 mobile-app 05 独立终审发现 1(2026-11-16,threadId
01a1e1e9-f7c3-7550-927e-9e06deee6655)。编排侧现场核验:

- `MainActivity.java` 为空壳 `extends BridgeActivity {}`,无
  `registerPlugin(SaveToDownloadsPlugin.class)`;git 追溯它自
  6ed9d73(11-09 scaffold)生来如此,从未注册。
- `save-to-downloads.ts:13` registerPlugin 的 JS 代理 + `backup-file.ts:54`
  直调,无任何回退路径 → 真机点「保存到本机」必报插件未实现。
  (「分享备份」走官方 Filesystem+Share,自动注册,不受影响。)
- **矛盾待解**:票 05 记录 2026-11-13 真机人验「保存到本机+导入闭环过」
  ——当次可能实际走的是分享路径,或误记。修复后真机复按一次保存到本机
  即可澄清。

修法:MainActivity 注册插件(Capacitor 8 `onCreate` 内 registerPlugin);
加注册声明检查门(构建/测试期断言 JS registerPlugin 名单与原生注册名单
一致,memory adapter 测试够不到这条真机路径)。

## Comments

- 2026-11-16 立票。

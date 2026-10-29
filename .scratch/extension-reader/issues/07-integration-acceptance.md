# 07: 整装验收与加载说明

**What to build:** 用户验收路径整装跑通：从零 load-unpacked 加载扩展 → 打开 EPUB → 音标行 → 点词改态 → 重开回位 → 断网复验；PDF 按 06 判定走通；README 交代加载方式、数据自决（卸载即清）与边界。收官前加一道独立 cc-suite 审核门。全仓 lint/typecheck/test 绿收官。

**Blocked by:** 04、05、06

**Status:** done

- [x] 从零加载到断网复验的完整验收路径走通，记录进本票 ## Comments
- [x] PDF 路径按 01/06 判定走通
- [x] README：加载说明、数据自决、边界（扫描版/DRM/超大文件）
- [x] 全仓 lint、typecheck、test 全绿
- [x] 独立 cc-suite 审核通过：qwen-review 走查扩展整 diff；qwen_not_found 时按本票降级为 Codex 审查 lane，不得静默跳过；发现项修复或另立 needs-triage 存根票

## Comments

**收官(2026-10-28,实现会话)**:全仓 verify 绿(427 测试);三份独立审查(双轴
sub-agent + Codex 降级 lane)的硬发现全部修复,判定 call 落存根票。

- **验收路径(机器可跑部分已全部自动化,证据在本会话三次 smoke)**:
  1. 构建:`npm run bake:dictionary --workspace @lingualeaf/extension`(词典资产,
     实测 14.9MB)→ `npm run build --workspace @lingualeaf/extension` → dist/ 含
     manifest(reader/pdf worker/词典全就位)。
  2. EPUB 线:选择文件 → 目录+分章 → 音标行(词-音标配对)→ 点词弹卡(真词典词条+
     查词即状态入学习中)→ 显式改态 → 底色即时变化 → 打开其他文件 → 最近文档回位。
  3. PDF 线(01 判定原位):多栏+断字样本打开 → 原位叠加(几何断言 73/73 词落位、
     73/73 chip 在位)→ 翻页 → 开关 → 弹卡;扫描版/损坏 PDF 各得「书」词条/损坏文案。
  4. 断网复验:全流程请求数 4、外部请求 0(架构无跨源调用,断网等价成立)。
  5. **人工验收(2026-10-29 回报,闭环)**:真 Edge load-unpacked 实测——EPUB 正常;
     PDF 四连修(重影=词层文字透明化、发虚=dpr 出图、白条=禁选区+hover 半透明、
     偏离=measureText 比例定位)后用户结论「可以将就了」——残余的像素级偏移(量测
     字体 vs 内嵌字体度量差)用户接受。右键菜单与真·断网开关未单独回报异常。
     人工验收闭环。
- **README**:apps/extension/README.md 新增(加载步骤/词典烘焙/数据自决/边界);
  根 README 项目结构段更新(新包与扩展条目)。
- **审查门(票面义务)**:qwen preflight `qwen not found`(实测留痕)→ 按票面降级
  Codex 审查 lane(codex-runner read-only,gpt-6.1-sol)——VERDICT NEEDS REVISION,
  10 findings:2 条与双轴重合(权限缺失/overlay 样式缺失,P1),posix join 尾斜杠
  (服务端行为漂移,实锤修复+27 例 fuzz+测试钉)、chrome 后端并发写互吞(整快照读
  改写,写队列互斥修复)、enroll 非原子(查词即状态迟到覆盖显式状态,队列内原子修复)、
  PDF 渲染并发拒绝(渲染队列修复)、分词不合 WORD_PATTERN(改共享词规则修复)、重开
  无 latest 守卫(修复);2 条记档为已知限制(比例字体 charWidth 近似——词-音标配对
  自洽、同 pdf.js textLayer 近似;旋转文本)。双轴 sub-agent 另贡献:GLOSSARY 词元
  措辞修复(扩展侧,web 端旧措辞另立存根票 web-lemma-copy)、FileReader 统一、
  manifest/aria 文案随能力更新、复用收敛候选存根票 ext-reuse-convergence。
- **全绿门**:npm run verify(typecheck 五工程/vitest 427/eslint --max-warnings 0/
  三 locality/五包构建)+ 三份 smoke 重跑,全部通过。
- **遗留(均已有主)**:web-lemma-copy 与 ext-reuse-convergence 两张 needs-triage;
  PDF 字节持久化(重开需重选文件)与断字跨行合并记在 06 Comments 为另票候选。

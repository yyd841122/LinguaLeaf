# on-demand-translation:导入只注音标，译文按章按需翻译

来源:2026-10-23 grilling 会话,13 个决策全部与维护者对齐并锁定。领域决策落为
docs/adr/0004(取代 docs/adr/0002 的译文生成时机半边;音标导入时生成维持不变)。
动机即 ADR-0002 自述的两处代价:导入要等几分钟、为没读的部分白花 LLM 费用。

## 问题

导入管线第二阶段(translating)用 DeepSeek 把整本书译完才落库:音标本是本地词典
查询(零费用、秒级),却被网络翻译拖着陪跑。库里"哪章译过"无处可查(chapters 表
没有任何翻译状态列);阅读页对 NULL 译文一律渲染空占位行,前端没有任何"触发服务端
长任务后按章跟进"的先例(轮询只存在于书架导入流程)。

## 方案

- **导入删阶段,不删机制**:import-task 的 translating 阶段整体移除
  (annotating → saving 直达);导入仍是异步任务(票 08 的机器不动),wire 的
  ImportStage 收窄,importCopy 文案同步删除。
- **章级状态机**:chapters 表加 translation_status
  (untranslated/translating/translated/failed)、translation_error 与
  translation_percent,镜像 books.import_* 的模式;启动清扫把残留 translating
  的章置为 failed(照 failInterruptedImports 的模式)。
- **触发路由**:POST /api/books/:id/chapters/:chapter/translate,先过
  respondIfNotReady;同章翻译中再点 409(新守卫,样式照既有家族);否则置
  translating、202 返回,`void` 起后台任务——复用 translateChapters(按句计数
  回调写百分比);跨章任务彼此独立,不建串行队列。章内容 GET 载荷增发
  translationStatus;翻译服务可用性(未配 DEEPSEEK_API_KEY)随现有载荷暴露
  (挂哪个载荷实现时定,不建新配置端点)。
- **阅读页**:工具栏第三按钮,作用于当前章,按状态变形——未翻译「翻译本章」/
  翻译中「翻译中 N%」禁用/已翻译「重新翻译」;1.5s 轮询照抄书架先例。整章零
  译文 → 译文行不渲染、显示开关对译文行置灰;个别句失败留的洞 → 维持现状空
  占位行。未配翻译服务 → 按钮置灰加提示。
- **导出零改动**:缺译文省略行的容错已被测试钉住,不设"先翻译才能导出"门槛。

## 决策

1. 章是翻译的最小触发粒度,不做「翻译全书」一键——整本一键成本与导入全量相同,只是等待换个位置。
2. 重翻直接覆盖旧译文,无确认弹窗;同章翻译中再点 409;不同章允许并行。
3. 部分句 3 轮重试仍失败 → 留空,章节仍算 translated,不加"N 句未译出"提示——translation-join 钉住的留空语义原样沿用。
4. 翻译中按钮显示百分比进度,不用无限 spinner。
5. 旧书译文数据零改动、零 LLM 重跑;但新状态列初值按存量推导(有句子块的章置
   translated)——否则旧书会被误判未翻译,恰恰破坏"旧书行为不变"。
6. 导入保持异步任务管线,只删 translating 阶段——标注+保存本就秒级,但不为提速
   推翻票 08 的异步设计。

## 门禁

每个实现 commit:`npm run typecheck && npm test && npm run lint` 绿(看退出码,
不看 tail);收尾 `npm run verify` 全绿。行为信封:既有契约断言零删除零改写,新增
只追加;translation-join 的「留空」语义与导出「省略译文行」行为信封(reading-model
行为测试)零改动;409 家族只对新路由加盖,既有成员不动。新钉的契约:同章翻译中
再点 409;章载荷带 translationStatus;重启清扫 translating → failed。

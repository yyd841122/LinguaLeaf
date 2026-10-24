# 生词本四态:词元状态表 + 弹窗状态操作 + Known/Ignored 视觉弱化

Status: ready-for-agent
Type: task

按 `../spec.md` 落地,领域规则以 `docs/adr/0005-vocabulary-four-state-model.md` 为准。
动工前先跑一轮 grilling:状态表落点(book-store 内还是独立 module)、lookup 自动迁移的
写入口、弹窗操作的 API 形状——spec 只给了方向。

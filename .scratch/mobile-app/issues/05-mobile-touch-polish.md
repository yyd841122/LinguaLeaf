# 05 第一批收口:触控/安全区/深色跟随
Status: ready-for-agent(2026-11-09 立票)
Blocked by: 04

## 目标

第一批移动端体验收口:触控目标、安全区、深色模式跟随系统、键盘遮挡。

## 范围

- 触控目标尺寸与间距:点词命中区、弹窗按钮、显示开关
- 安全区 insets:刘海/手势条不留白不错位
- 深色模式:prefers-color-scheme 跟随系统;现状取数(2026-11-09):apps/web/src/style.css 无 @media 断点,packages/reading-model/src/annotated-style.css 仅一条 640px——暗色既有面以现场量定再动,不预设规模
- 键盘场景:笔记编辑、key 输入不被软键盘遮挡

## 验收门

- 根 verify EXIT=0
- 真机【人验】:日常操作无误触;系统切暗色 App 跟随;笔记编辑键盘不遮输入框

# 音标位置 over/under 可切换

Status: wontfix
Type: task

来源:旧仓库复盘(2026-10-24)。p0 原型支持音标在词上/词下切换(decorate.js
data-ipa-pos),但那是 epub.js iframe 渲染管不了行高的代偿方案。LinguaLeaf 的句子块
自持布局,GLOSSARY「音标行」词条已把位置定为「对应词的正下方」——做这个功能要先改
词条,而正下方正是逐词对齐模型的设计选择。不做了;哪天词条改了再重开票。

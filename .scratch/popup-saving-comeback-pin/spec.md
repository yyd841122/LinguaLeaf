# popup-saving-comeback-pin:切回在途词(A→B→A)的行禁用行为无测试钉

Status: needs-triage

来源:stale-put-saving-clobber 收官双轴 review 的 Standards 轴 judgement
call(2026-10-27)。行为本身是那票 spec 决策 3 明文断言的正确行为:切回在途
词按钮禁用为真,写落地后条目删除按钮自启;现仅由源码注释承载
(WordLookupPopup.tsx,「A word revisited while its write is still in
flight shows its row disabled until the write lands—the owner token's
key-comparison revival rule.」),没有测试走 A 保存→切 B→切回 A
的再入路径。

## 开放决策

是否落一条 characterization 测试钉住(woke 在途→切 book→切回
woke→行禁用;woke settle→自启),测试名自认「行为故意改变时本
条翻转」。stale-put-saving-clobber 的回归测试节只定义了 B 窗钉子(单条),
再入钉按票面范围未收。若 triage 判定值得收,须一并锁:是否连带钉「同 lemma
词形共享条目」(runs/run 共享一条目,同为决策 3 附带行为,同样无测试);
测试放 wordLookup.test.tsx 现成 harness 还是另起。

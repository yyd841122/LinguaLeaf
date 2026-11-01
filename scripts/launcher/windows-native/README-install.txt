LinguaLeaf — Windows 原生安装说明
=====================================

【装了什么】
本安装包把程序装到你选择的目录(默认
  %LOCALAPPDATA%\Programs\LinguaLeaf),
自带便携版 Node.js 运行时(runtime\ 文件夹),不修改系统全局环境,
不需要管理员权限。卸载时删除安装目录即可。

【第一次启动前:拷入你的数据(重要)】
安装包不含个人数据。把下面两样从旧电脑拷到安装目录(和
start-lingualeaf.bat 同级):

  1. .env    —— 翻译功能配置(含 API key,走私人渠道,别放网盘公开链接)
  2. .data\  —— 整个文件夹:你的书、阅读进度、生词本、词库(约 116MB)

旧电脑上这两样的位置(文件管理器地址栏粘贴):
  \\\\wsl$\\Ubuntu-24.04\\home\\youyd\\projects\\claudeProjects\\LinguaLeaf
提示:拷之前先在旧电脑双击 lingualeaf-stop.bat 停服务。

没有 .data 也能启动(空书架),但需要重新导入书籍并重建词库(见仓库
README 的「词库导入」一节)。没有 .env 能启动,但翻译功能不可用。

【日常使用】
- 启动:双击桌面「LinguaLeaf」快捷方式(或安装目录里
  start-lingualeaf.bat)。首次启动会联网安装生产依赖(约 1 分钟),
  之后秒开;浏览器自动打开 http://127.0.0.1:3000/
- 停止:双击安装目录里的 stop-lingualeaf.bat(按启动记录的进程号停止,
  不按端口)。
- 端口与路径可在 .env 里改(HOST / PORT / DATABASE_PATH),改完重启。

【升级】
拿到新的 LinguaLeaf-setup-<版本>.exe 后,直接运行并安装到同一目录,
程序文件被覆盖;你的 .env 和 .data 不在安装包里,天然保留。

【卸载】
Windows「设置 → 应用」里卸载,或运行安装目录的 Uninstall 快捷方式。
卸载只删安装包带来的文件;你的数据(.env、.data、node_modules、日志)
会留下,确认不要了再手动删除整个安装目录。

【常见问题】
- 首次启动提示依赖安装失败:检查网络(依赖从 npm 与 GitHub 下载),
  成功后重新双击启动即可,已装的部分不会重复下载。
- 提示端口被占用:说明 3000 端口有其他程序,改 .env 的 PORT 后重启。
- 防火墙首启弹窗:选「允许」(仅专用网络即可)。

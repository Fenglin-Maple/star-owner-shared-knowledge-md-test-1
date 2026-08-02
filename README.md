# star-owner-shared-knowledge-md-test-1

这是由“星藏家”初始化的 B站视频总结共享仓库。仓库只接收已经完成的 B站视频 Markdown 总结、必要的脱敏元数据和 Markdown 引用的图片资源，不接收原始视频、音频、Cookie、API Key、ASR 缓存或应用数据库。

## 使用方式

1. 在“星藏家 → B站之外 → GitHub 文档共享”中把本仓库设为当前共享仓库。
2. 仓库主人通过应用创建临时分支和 Pull Request；其他贡献者通过应用创建 Fork、分支和 Pull Request。
3. Pull Request 会由 GitHub Actions 检查目录结构、文件类型和必要元数据。
4. 合并到 `main` 后，GitHub Actions 会更新 `catalog.json`。

## 目录结构

`<github-numeric-id>/<bilibili|single|multipart>/col-<source-hash>/doc-<stable-id>/`

同一个 BVID 的不同总结可以共存。请勿提交原始媒体、密钥、数据库或系统绝对路径。

仓库：Fenglin-Maple/star-owner-shared-knowledge-md-test-1

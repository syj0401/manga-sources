# manga-sources：漫画阅读器在线源规则

这是漫画阅读器 v2.0.2 及以后版本的在线源规则仓库，必须是**公开仓库**。App 内的仓库地址写死在 `www/js/remote-sources.js` 的 `REMOTE_SOURCES_REPO`（当前是 `syj0401/manga-sources`，分支 `main`）。

App 读取规则的地址：
- 主地址：`https://raw.githubusercontent.com/syj0401/manga-sources/main/manifest.json`
- 备用镜像：`https://cdn.jsdelivr.net/gh/syj0401/manga-sources@main/manifest.json`（主地址失败时自动使用）

## 目录
- `manifest.json`：版本信息（schemaVersion、rulesVersion、minAppVersion），以及每个文件的 sha256 和 size
- `sources.json`：正常区的源配置，格式与 App 内置的 `data/sources.json` 相同
- `adapters/<名字>.js`：适配器。文件名必须与 `registerVeneraAdapter('<名字>', …)` 中的名字一致
- `tools/build-manifest.js`：重新计算 manifest

## 怎么发布新版本
1. 修改 `sources.json`，或修改、新增 `adapters/*.js`。
2. 升版本号并重新计算哈希：
   ```
   node tools/build-manifest.js --version 2026.11.26-1
   ```
   - 版本号建议用「日期-序号」格式。只要版本号或内容有变化，App 就会更新。
   - 如果新规则用到了新版 App 才有的能力，加上 `--min-app 2.0.3`。低于该版本的 App 会拒绝这套规则，继续用旧规则。
3. 把 manifest.json 和改动的文件**一起**提交、推送到 `main`。如果只推了一部分，哈希会对不上，App 会整套拒收，并保留上一版规则。
4. jsDelivr 镜像有缓存，可能要等几小时才更新；raw 地址通常在 5 分钟内生效。镜像暂时是旧内容时，App 会因哈希不符拒收旧文件，不会混用新旧文件。

## App 端的规则（改了也无效）
- 成人区的源只用 App 内置配置。远程 `sources.json` 里成人区的条目会被忽略，包括与内置成人源 id 相同的条目，以及使用成人专用适配器的条目。
- 被成人区源使用的适配器（jm、manwa、wnacg、copy）不接受远程替换。
- `paywallModel` 一律强制为 `free_only`。正常区的标签黑名单只能增加，不能删减。
- App 已移除的源（happy、mh18、zaimanhua、hotmanga、mangadex-debug）不会因为远程规则而恢复。
- 远程代码如果试图修改成人区解锁状态、源开关或设置，App 会整套回退到内置规则。
- 新规则加载出错时，App 自动回退到内置规则，并在「我的 → 源规则更新」中显示错误。用户也可以手动点「恢复内置源」。

## 信任边界
App 只执行从本仓库下载、并且与 manifest 中 sha256 一致的代码。但 manifest 本身没有单独签名，**谁能推送到这个仓库，谁就能让 App 执行新的适配器代码**。请开启 GitHub 两步验证，不要给他人推送权限。

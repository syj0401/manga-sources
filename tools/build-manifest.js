#!/usr/bin/env node
/* 重新计算 manifest.json：node tools/build-manifest.js [--version 2026.11.25-2] [--min-app 2.0.2]
   - 收录 sources.json 和 adapters/*.js（文件名 = 适配器注册名，小写字母/数字/-/_）
   - sha256 / size 按文件原始字节计算；拒绝带 BOM 的文件（App 端解码会去掉 BOM，导致校验不符）
   - 不传 --version 时沿用旧版本号（会提示），发布前务必升版本号 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const manifestPath = path.join(root, 'manifest.json');
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const rulesVersion = opt('--version') || old.rulesVersion;
const minAppVersion = opt('--min-app') || old.minAppVersion || '2.0.2';
if (!rulesVersion) { console.error('缺少 --version'); process.exit(1); }
if (!opt('--version')) console.warn('提示：沿用旧版本号 ' + rulesVersion + '，App 只会在版本号或内容变化时更新');
const files = ['sources.json', ...fs.readdirSync(path.join(root, 'adapters')).filter(f => f.endsWith('.js')).sort().map(f => 'adapters/' + f)];
const out = [];
for (const rel of files) {
  if (!/^(sources\.json|adapters\/[a-z0-9_-]{1,40}\.js)$/.test(rel)) { console.error('文件名不合法：' + rel); process.exit(1); }
  const buf = fs.readFileSync(path.join(root, rel));
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { console.error('请去掉 BOM：' + rel); process.exit(1); }
  if (rel === 'sources.json') {
    const j = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(j.sources)) { console.error('sources.json 缺少 sources 数组'); process.exit(1); }
    const bad = j.sources.filter(s => s.zone !== 'normal' || s.paywallModel !== 'free_only');
    if (bad.length) console.warn('警告：这些条目不是正常区 free_only，App 会忽略或强制改回：' + bad.map(s => s.id).join(','));
  } else {
    const name = path.basename(rel, '.js');
    if (!buf.toString('utf8').includes("registerVeneraAdapter('" + name + "'")) console.warn('警告：' + rel + " 没有 registerVeneraAdapter('" + name + "')，App 加载时会回退内置");
  }
  out.push({ path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length });
}
const manifest = { schemaVersion: 1, rulesVersion, minAppVersion, updatedAt: new Date().toISOString(), files: out };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest.json 已更新：' + rulesVersion + '，' + out.length + ' 个文件');

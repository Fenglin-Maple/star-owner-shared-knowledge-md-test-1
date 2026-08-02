import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const metadataName = '_star-owner-document.json';
const namespaces = new Set(['bilibili', 'single', 'multipart']);
const allowedExtensions = new Set(['.md', '.json', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const forbiddenNames = /(?:cookie|secret|api[-_]?key|token|credential|database|sqlite|session)/i;
const infrastructureFiles = new Set([
  'README.md', '_star-owner-repository.json', '.gitattributes', '.gitignore', 'CONTRIBUTING.md', 'SECURITY.md', 'catalog.json',
  '.github/CODEOWNERS', '.github/pull_request_template.md', '.github/workflows/validate-shared-docs.yml', '.github/workflows/build-catalog.yml',
  'scripts/validate-shared-docs.mjs', 'scripts/build-catalog.mjs'
]);
const errors = [];

function fail(message) { errors.push(message); }
function relative(file) { return path.relative(root, file).split(path.sep).join('/'); }
function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { fail('禁止符号链接：' + relative(file)); continue; }
    if (entry.isDirectory()) output.push(...walk(file));
    else if (entry.isFile()) output.push(file);
  }
  return output;
}
function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  return Boolean(normalized) && !normalized.startsWith('/') && !normalized.split('/').some((part) => !part || part === '.' || part === '..');
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function pullRequestChanges() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || !process.env.GITHUB_EVENT_PATH) return { files: [], actorId: '' };
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const baseSha = String(event.pull_request?.base?.sha || '');
    const actorId = String(process.env.GITHUB_ACTOR_ID || event.sender?.id || '');
    if (!/^[a-f0-9]{40}$/i.test(baseSha)) throw new Error('缺少 Pull Request base SHA');
    const output = execFileSync('git', ['diff', '--name-only', baseSha + '...HEAD'], { cwd: root, encoding: 'utf8' });
    return { files: output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), actorId };
  } catch (error) {
    fail('无法核对 Pull Request 变更目录：' + error.message);
    return { files: [], actorId: '' };
  }
}

const allFiles = walk(root);
const metadataFiles = allFiles.filter((file) => path.basename(file) === metadataName);
const declaredByRoot = new Map();
for (const metadataFile of metadataFiles) {
  const metadataPath = relative(metadataFile);
  const segments = metadataPath.split('/');
  if (segments.length !== 5 || segments[4] !== metadataName) { fail(metadataPath + ': 文档必须位于标准五层目录'); continue; }
  const [contributor, namespace, collection, document] = segments;
  if (!/^\d+$/.test(contributor)) fail(metadataPath + ': 顶层贡献者目录必须是 GitHub 数字 ID');
  if (!namespaces.has(namespace)) fail(metadataPath + ': 不支持的来源命名空间 ' + namespace);
  if (!/^col-[a-f0-9]{24}$/.test(collection)) fail(metadataPath + ': 收藏夹来源 ID 格式错误');
  if (!/^doc-[a-f0-9]{24}$/.test(document)) fail(metadataPath + ': 文档 ID 格式错误');
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch (error) { fail(metadataPath + ': JSON 无法解析 (' + error.message + ')'); continue; }
  if (metadata.sourceType !== 'bilibili-video-summary') fail(metadataPath + ': sourceType 必须是 bilibili-video-summary');
  if (String(metadata.documentId || '') !== document) fail(metadataPath + ': documentId 与目录不一致');
  if (String(metadata.contributorGithubId || '') !== contributor) fail(metadataPath + ': contributorGithubId 与目录不一致');
  if (!/^BV[0-9A-Za-z]{10}$/i.test(String(metadata.bvid || ''))) fail(metadataPath + ': BVID 格式错误');
  const expectedType = namespace === 'multipart' ? 'multipart-parent' : 'single-video';
  if (metadata.documentType !== expectedType) fail(metadataPath + ': documentType 应为 ' + expectedType);
  const schemaVersion = Number(metadata.schemaVersion || 0);
  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const declared = new Set([metadataName]);
  if (!files.length) fail(metadataPath + ': files 不能为空');
  for (const item of files) {
    const itemPath = String(item || '').replaceAll('\\', '/');
    if (!safeRelative(itemPath) || forbiddenNames.test(itemPath)) { fail(metadataPath + ': 文件路径不安全 ' + itemPath); continue; }
    declared.add(itemPath);
    if (!allowedExtensions.has(path.extname(itemPath).toLowerCase())) fail(metadataPath + ': 不允许的文件类型 ' + itemPath);
    const target = path.resolve(path.dirname(metadataFile), itemPath);
    const documentRoot = path.resolve(path.dirname(metadataFile));
    if (!target.startsWith(documentRoot + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) fail(metadataPath + ': 缺少资源 ' + itemPath);
    if (fs.existsSync(target) && fs.statSync(target).size > 25 * 1024 * 1024) fail(metadataPath + ': 单文件超过 25 MiB ' + itemPath);
  }
  const canonicalMarkdown = namespace === 'multipart' ? 'index.md' : 'summary.md';
  const entryMarkdown = String(metadata.entryMarkdown || canonicalMarkdown).replaceAll('\\', '/');
  const documentRoot = path.resolve(path.dirname(metadataFile));
  if (!safeRelative(entryMarkdown) || !/.md$/i.test(entryMarkdown)) fail(metadataPath + ': 入口 Markdown 路径不安全');
  if (schemaVersion >= 3 && entryMarkdown !== canonicalMarkdown) fail(metadataPath + ': schema v3 入口 Markdown 必须是 ' + canonicalMarkdown);
  if (!files.includes(entryMarkdown)) fail(metadataPath + ': 缺少入口 Markdown ' + entryMarkdown);
  if (schemaVersion >= 3) {
    for (const item of files) {
      const itemPath = String(item || '').replaceAll('\\', '/');
      const extension = path.extname(itemPath).toLowerCase();
      const allowedMarkdown = namespace === 'multipart'
        ? itemPath === 'index.md' || /^parts\/cid-[A-Za-z0-9._-]+\/summary\.md$/.test(itemPath)
        : itemPath === 'summary.md';
      if (extension === '.md' && !allowedMarkdown) fail(metadataPath + ': schema v3 不允许过程 Markdown ' + itemPath);
      if (extension !== '.md' && !new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']).has(extension)) fail(metadataPath + ': schema v3 不允许过程缓存 ' + itemPath);
    }
  }
  const entryFile = path.resolve(path.dirname(metadataFile), entryMarkdown);
  const contentHash = String(metadata.contentSha256 || '');
  if (schemaVersion >= 3 && !/^[a-f0-9]{64}$/i.test(contentHash)) fail(metadataPath + ': 缺少有效的入口 Markdown SHA-256');
  if (entryFile.startsWith(documentRoot + path.sep) && fs.existsSync(entryFile) && /^[a-f0-9]{64}$/i.test(contentHash) && sha256File(entryFile) !== contentHash.toLowerCase()) {
    fail(metadataPath + ': 入口 Markdown SHA-256 不匹配');
  }
  for (const [itemPath, expectedHash] of Object.entries(metadata.markdownSha256 || {})) {
    if (!safeRelative(itemPath) || !files.includes(itemPath)) { fail(metadataPath + ': Markdown 哈希声明路径无效 ' + itemPath); continue; }
    const target = path.resolve(path.dirname(metadataFile), itemPath);
    if (!target.startsWith(documentRoot + path.sep) || !fs.existsSync(target) || !/^[a-f0-9]{64}$/i.test(String(expectedHash)) || sha256File(target) !== String(expectedHash).toLowerCase()) fail(metadataPath + ': Markdown SHA-256 不匹配 ' + itemPath);
  }
  for (const [itemPath, expectedHash] of Object.entries(metadata.assetSha256 || {})) {
    if (!safeRelative(itemPath) || !files.includes(itemPath)) { fail(metadataPath + ': 资源哈希声明路径无效 ' + itemPath); continue; }
    const target = path.resolve(path.dirname(metadataFile), itemPath);
    if (!target.startsWith(documentRoot + path.sep) || !fs.existsSync(target) || !/^[a-f0-9]{64}$/i.test(String(expectedHash)) || sha256File(target) !== String(expectedHash).toLowerCase()) fail(metadataPath + ': 资源 SHA-256 不匹配 ' + itemPath);
  }
  declaredByRoot.set(segments.slice(0, 4).join('/'), declared);
}

for (const file of allFiles) {
  const name = relative(file);
  if (forbiddenNames.test(name) || /\.(mp4|mkv|webm|mp3|wav|flac|sqlite|db)$/i.test(name)) fail('禁止提交敏感或原始媒体文件：' + name);
  if (infrastructureFiles.has(name)) continue;
  const parts = name.split('/');
  const documentRoot = parts.slice(0, 4).join('/');
  const declared = declaredByRoot.get(documentRoot);
  const documentRelative = parts.slice(4).join('/');
  if (!declared) fail('文件不在标准文档目录或仓库配置白名单中：' + name);
  else if (!declared.has(documentRelative)) fail('文档包含未在元数据 files 中声明的文件：' + name);
}

const pullRequest = pullRequestChanges();
for (const changed of pullRequest.files) {
  const normalized = String(changed).replaceAll('\\', '/');
  if (infrastructureFiles.has(normalized)) { fail('Pull Request 不允许修改仓库配置文件：' + normalized); continue; }
  const segments = normalized.split('/');
  if (segments.length < 5 || !/^\d+$/.test(segments[0]) || !namespaces.has(segments[1]) || !/^col-[a-f0-9]{24}$/.test(segments[2]) || !/^doc-[a-f0-9]{24}$/.test(segments[3])) {
    fail('Pull Request 文件不在标准贡献目录：' + normalized);
    continue;
  }
  if (pullRequest.actorId && segments[0] !== pullRequest.actorId) fail('Pull Request 只能修改当前 GitHub 账户自己的数字 ID 目录：' + normalized);
}

if (errors.length) { console.error(errors.map((item) => '- ' + item).join('\n')); process.exit(1); }
console.log('shared document validation passed (' + metadataFiles.length + ' document(s))');

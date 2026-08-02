import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const metadataName = '_star-owner-document.json';
function relative(file) { return path.relative(root, file).split(path.sep).join('/'); }
function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(file));
    else if (entry.isFile() && entry.name === metadataName) output.push(file);
  }
  return output;
}
const documents = walk(root).map((file) => {
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  const metadataPath = relative(file);
  return {
    documentId: String(metadata.documentId || ''), documentType: String(metadata.documentType || ''), bvid: String(metadata.bvid || ''),
    title: String(metadata.title || ''), owner: String(metadata.owner || ''), collectionName: String(metadata.collectionName || ''),
    contributorGithubId: String(metadata.contributorGithubId || metadataPath.split('/')[0] || ''),
    updatedAt: String(metadata.updatedAt || metadata.uploadedAt || ''), metadataPath,
    documentRoot: metadataPath.slice(0, -metadataName.length)
  };
}).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.metadataPath.localeCompare(b.metadataPath));
const generatedAt = documents.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '');
const output = JSON.stringify({ schemaVersion: 1, generatedAt, total: documents.length, documents }, null, 2) + '\n';
fs.writeFileSync(path.join(root, 'catalog.json'), output, 'utf8');
console.log(`shared catalog written (${documents.length} document(s))`);

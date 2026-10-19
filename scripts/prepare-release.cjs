const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'public');
fs.mkdirSync(target, { recursive: true });
// Somente os arquivos do aplicativo são publicados; backups ficam no computador.
const files = ['app-assets.json', ...JSON.parse(fs.readFileSync(path.join(root, 'app-assets.json'), 'utf8'))];
const extra = fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(target, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/')).filter(name => !files.includes(name));
if (extra.length) throw new Error('A pasta public contém arquivos inesperados; revise antes de publicar.');
for (const file of files) {
  if (file.includes('..') || path.isAbsolute(file)) throw Error('Caminho inválido na lista de publicação.');
  fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(target, file));
}
console.log(`Aplicativo preparado para publicação (${files.length} arquivos).`);

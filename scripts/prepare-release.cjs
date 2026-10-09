const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'public');
fs.mkdirSync(target, { recursive: true });
// Somente os arquivos do aplicativo são publicados; backups ficam no computador.
const files = ['index.html', 'sw.js', 'royal-wallet-features.js'];
const extra = fs.readdirSync(target).filter(name => !files.includes(name));
if (extra.length) throw new Error('A pasta public contém arquivos inesperados; revise antes de publicar.');
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(target, file));
console.log('Aplicativo preparado para publicação (3 arquivos).');

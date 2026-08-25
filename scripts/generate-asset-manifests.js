const fs = require('fs');
const path = require('path');

const publicRoot = path.join(__dirname, '../public');
const imagePattern = /\.(png|jpe?g|webp|svg)$/i;

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const mockupRoot = path.join(publicRoot, 'mockups');
const mockups = walk(mockupRoot).filter(file => imagePattern.test(file)).map(file => {
  const relative = path.relative(mockupRoot, file).replaceAll(path.sep, '/');
  const [product, filename] = relative.split('/');
  const match = filename.match(/^(front|back|left-sleeve|right-sleeve)-(.+)\.[^.]+$/i);
  return {
    product,
    view: match ? match[1] : 'unknown',
    color: match ? match[2] : 'unknown',
    path: `/mockups/${relative}`,
    width: 1600,
    height: 2000,
    production_source: `/mockup-masters/${product}-${match ? match[1] : 'unknown'}-gray.png`
  };
}).sort((a, b) => `${a.product}/${a.view}/${a.color}`.localeCompare(`${b.product}/${b.view}/${b.color}`));

const premadeRoot = path.join(publicRoot, 'premades');
const premades = walk(premadeRoot).filter(file => imagePattern.test(file)).map(file => {
  const relative = path.relative(premadeRoot, file).replaceAll(path.sep, '/');
  const parts = relative.split('/');
  return {
    category: parts.length > 1 ? parts[0] : 'Uncategorized',
    name: path.basename(file, path.extname(file)),
    path: `/premades/${relative}`,
    restricted: parts[0] === '18+'
  };
}).sort((a, b) => `${a.category}/${a.name}`.localeCompare(`${b.category}/${b.name}`, undefined, { numeric: true }));

fs.writeFileSync(path.join(mockupRoot, 'manifest.json'), `${JSON.stringify({ version: 1, generated_at: new Date().toISOString(), count: mockups.length, assets: mockups }, null, 2)}\n`);
fs.writeFileSync(path.join(premadeRoot, 'manifest.json'), `${JSON.stringify({ version: 1, generated_at: new Date().toISOString(), count: premades.length, public_count: premades.filter(item => !item.restricted).length, categories: [...new Set(premades.map(item => item.category))], items: premades.filter(item => !item.restricted), assets: premades }, null, 2)}\n`);

console.log(JSON.stringify({ mockups: mockups.length, premades: premades.length, restricted: premades.filter(item => item.restricted).length }, null, 2));

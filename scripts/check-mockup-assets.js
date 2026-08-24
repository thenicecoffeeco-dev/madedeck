const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..','public');
const manifestPath=path.join(root,'mockups','manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const required=[];

for(const [productKey,product] of Object.entries(manifest.products)){
  if(Array.isArray(product.assets)){
    for(const asset of product.assets)required.push({productKey,view:asset.view||'front',color:asset.color||null,path:asset.path});
    continue;
  }
  const colors=product.colors||[null];
  const views=product.views||['front'];
  for(const color of colors){
    for(const view of views){
      const url=product.pattern.replace('{view}',view).replace('{color}',color||'').replace('{size}',view);
      required.push({productKey,view,color,path:url});
    }
  }
}

const results=required.map(asset=>({...asset,exists:fs.existsSync(path.join(root,asset.path.replace(/^\//,'')))}));
const missing=results.filter(asset=>!asset.exists);
const summary={required:results.length,present:results.length-missing.length,missing:missing.length,complete:missing.length===0};

console.log(JSON.stringify({summary,missing},null,2));
process.exitCode=missing.length?1:0;

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
function load(path,dependencies={}) {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',code)(name=>dependencies[name]??require(name),module,module.exports);
 return module.exports;
}
const currencies=load('../src/modules/commerce/currencies.ts');
const {ProductInput,ProductUploadInput}=load('../src/modules/commerce/product-input.ts',{'./currencies':currencies, '@/lib/validation':load('../src/lib/validation.ts')});
test('product editing preserves all images and videos with a selected currency',()=>{
 const images=Array.from({length:12},(_,i)=>`https://example.com/${i}.jpg`);
 const videos=['https://example.com/demo.mp4','https://example.com/demo.webm'];
 const result=ProductInput.parse({name:'منتج',price:42,currency:'try',images,videos});
 assert.equal(result.currency,'TRY');assert.deepEqual(result.images,images);assert.deepEqual(result.videos,videos);
 assert.equal(ProductInput.safeParse({...result,currency:'₺'}).success,false);
 assert.equal(ProductInput.safeParse({...result,images:[...images,'https://example.com/extra.jpg']}).success,false);
 assert.equal(ProductInput.safeParse({...result,videos:['javascript:alert(1)']}).success,false);
});
test('upload validation accepts video and enforces image/video size boundaries',()=>{
 assert.ok(ProductUploadInput.safeParse({fileName:'clip.mp4',contentType:'video/mp4',size:25*1024*1024}).success);
 assert.equal(ProductUploadInput.safeParse({fileName:'clip.mp4',contentType:'video/mp4',size:25*1024*1024+1}).success,false);
 assert.equal(ProductUploadInput.safeParse({fileName:'photo.jpg',contentType:'image/jpeg',size:5*1024*1024+1}).success,false);
 assert.equal(ProductUploadInput.safeParse({fileName:'file.html',contentType:'text/html',size:10}).success,false);
});

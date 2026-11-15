import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
p.on('console',m=>console.log('['+m.type()+']',m.text().slice(0,400)));
p.on('pageerror',e=>console.log('PAGEERROR:',e.message,'\n',(e.stack||'').split('\n').slice(0,4).join('\n')));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForTimeout(3000);
console.log('has __fps:', await p.evaluate(()=>!!window.__fps));
await b.close();

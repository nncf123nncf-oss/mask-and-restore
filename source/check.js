// 実画面の確認（Chrome headless / CDP）。実行: node source/check.js <出力フォルダ>
// 375px/1000pxの矩形、ライト/ダーク、例文→伏せる→返事を貼る→戻す、XSS、端末への保存の有無、操作中の通信、コピー
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'check-out');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8778, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
const REPLY = '【お客様C】様\n\nはじめまして。ご連絡ありがとうございます。\n【会社A】の【お客様A】様より、社内研修のパンフレット撮影のご相談をいただきました。\n会場（【住所1】）での撮影、承れます。\n候補日をいくつかお送りしますので、お客様C様のご都合をお知らせください。\n\nなお、資料は【メール1】宛てにお送りしてよろしいでしょうか。';
const measure = `(()=>{const out={sw:document.documentElement.scrollWidth,iw:innerWidth,over:[],small:[]};
  document.querySelectorAll('main *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.right>innerWidth+0.5)out.over.push(e.tagName+'.'+e.className)});
  document.querySelectorAll('main button, main input, main select, main summary, main textarea').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&(r.height<43.5||r.width<43.5)&&!e.closest('.maptable')&&e.type!=='checkbox')out.small.push((e.textContent||e.type||e.tagName).slice(0,14)+':'+Math.round(r.width)+'x'+Math.round(r.height))});
  out.over=[...new Set(out.over)].slice(0,8);out.small=out.small.slice(0,8);return out})()`;
const setVal = (id, v) => `(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`;
const click = t => `[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)}).click()`;

(async () => {
  const b = await launch(9431);
  const reqs = []; let phase = 'load';
  b.on(m => { if (m.method === 'Network.requestWillBeSent') reqs.push(phase + ' ' + m.params.request.url.slice(0, 80)); });
  await b.send('Network.enable');
  if (!process.env.CHECK_BEACON) await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  await b.send('Browser.grantPermissions', { origin: ORIGIN.slice(0, -1), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});

  for (const scheme of ['light', 'dark']) {
    await b.open(ORIGIN, 375, 812, 2, true, scheme);
    console.log(scheme + '-375-empty', JSON.stringify(await b.ev(measure)));
    console.log(scheme + '-375-first-screen', JSON.stringify(await b.ev(`({srcTop:Math.round(document.getElementById('src').getBoundingClientRect().top),vh:innerHeight})`)));
    phase = 'ops';
    await b.ev(`window.confirm=()=>true;` + click('例文を入れる')); await b.sleep(400);
    await b.ev(setVal('reply', REPLY)); await b.sleep(400);
    phase = 'after';
    console.log(scheme + '-375-filled', JSON.stringify(await b.ev(measure)));
    console.log(scheme + '-counts', JSON.stringify(await b.ev(`[document.getElementById('maskcount').textContent, document.getElementById('restorecount').textContent, document.getElementById('restorewarn').innerText.replace(/\\n+/g,' / ')]`)));
    await b.shot(path.join(OUT, 'check-375-' + scheme + '.png'), { x: 0, y: 0, width: 375, height: Math.min(9000, await b.ev('document.documentElement.scrollHeight')) });
  }
  console.log('masked', JSON.stringify(await b.ev(`document.getElementById('masked').innerText`)));
  console.log('restored', JSON.stringify(await b.ev(`document.getElementById('restored').innerText`)));
  console.log('underlined', JSON.stringify(await b.ev(`[...document.querySelectorAll('#restored .rs')].map(e=>e.textContent)`)));
  // 切り替え
  await b.ev(`document.querySelector('#cands li:nth-child(2) .tg').click()`); await b.sleep(200);
  console.log('toggle', JSON.stringify(await b.ev(`[document.getElementById('maskcount').textContent, document.querySelector('#cands li:nth-child(2)').innerText.replace(/\\n+/g,' / ')]`)));
  await b.ev(`document.querySelector('#cands li:nth-child(2) .tg').click()`); await b.sleep(200);
  // 手で足す
  await b.ev(`document.getElementById('addword').value='パンフレット';document.getElementById('addkind').value='other';` + click('この言葉を伏せる')); await b.sleep(200);
  console.log('manual', JSON.stringify(await b.ev(`[document.getElementById('addmsg').textContent, document.getElementById('maskcount').textContent]`)));
  // 対応表
  await b.ev(`document.getElementById('mapbox').open=true`);
  console.log('map', JSON.stringify(await b.ev(`[...document.querySelectorAll('#maptable tr')].map(r=>r.innerText.replace(/\\s+/g,' '))`)));
  // コピー
  await b.ev(click('伏せた文をコピー')); await b.sleep(300);
  console.log('copy-mask', JSON.stringify(await b.ev(`(async()=>{let c='';try{c=await navigator.clipboard.readText()}catch(e){c='read-failed:'+e.name}return [document.getElementById('copymaskmsg').textContent,c.slice(0,60)]})()`)));
  // 1000px（Card2の幅）
  await b.open(ORIGIN, 1000, 900, 2, false, 'light');
  phase = 'ops2';
  await b.ev(`window.confirm=()=>true;` + click('例文を入れる')); await b.sleep(300);
  await b.ev(setVal('reply', REPLY)); await b.sleep(300);
  phase = 'after2';
  console.log('1000', JSON.stringify(await b.ev(measure)), JSON.stringify(await b.ev(`getComputedStyle(document.querySelector('.layout')).gridTemplateColumns`)));
  await b.shot(path.join(OUT, 'check-1000.png'), { x: 0, y: 0, width: 1000, height: Math.min(9000, await b.ev('document.documentElement.scrollHeight')) });
  // XSS
  await b.ev(`window.__x=0;` + setVal('src', '<img src=x onerror="window.__x=1">山田様"><script>window.__x=2</script>')); await b.sleep(300);
  await b.ev(`document.getElementById('addword').value='<b onmouseover=x>';` + click('この言葉を伏せる')); await b.sleep(200);
  await b.ev(setVal('reply', '<img src=x onerror="window.__x=3">【お客様A】様')); await b.sleep(300);
  console.log('xss', JSON.stringify(await b.ev(`({x:window.__x, imgs:document.querySelectorAll('main img').length, scripts:document.querySelectorAll('main script').length, b:document.querySelectorAll('main b').length, restored:document.getElementById('restored').innerText.slice(0,80)})`)));
  // 端末への保存
  console.log('storage', JSON.stringify(await b.ev(`(async()=>({ls:localStorage.length, ss:sessionStorage.length, idb:(indexedDB.databases?(await indexedDB.databases()).length:'n/a'), cookie:document.cookie}))()`)));
  // 10,000字
  const big = await b.ev(`(MR.SAMPLE+'\\n').repeat(60).slice(0,10000)`);
  const t0 = Date.now(); await b.ev(`(()=>{const e=document.getElementById('src');e.value=${JSON.stringify(big)};e.dispatchEvent(new Event('input'))})()`); await b.sleep(200);
  const ms = await b.ev(`(()=>{const t=performance.now();document.getElementById('src').dispatchEvent(new Event('input'));return new Promise(r=>setTimeout(()=>r(Math.round(performance.now()-t-150)),400))})()`);
  console.log('10000chars-recompute-ms(approx, debounce除く)', ms, JSON.stringify(await b.ev(`document.getElementById('maskcount').textContent`)));
  console.log('requests', JSON.stringify(reqs));
  b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });

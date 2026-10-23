// 投稿カード用の素材を撮る（Chrome headless / CDP・DPR2）。実行: node source/shoot.js <出力フォルダ>
// 01-x-primary: 560px幅・①の印が付いた文（Card1の第一候補）／02-masked: 560px幅・②伏せた文／03-restored-desktop: 1000px幅・③戻した文（Card2）
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8779, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
// 撮影用の返事は、ミナトが手で作った架空の返事（実際のAIの出力ではない）
const REPLY = '【お客様C】様\n\nはじめまして。ご連絡ありがとうございます。\n【会社A】の【お客様A】様より、社内研修のパンフレット撮影のご相談をいただきました。\n会場（【住所1】）での撮影、承れます。\n候補日をいくつかお送りしますので、お客様C様のご都合をお知らせください。\n\nなお、資料は【メール1】宛てにお送りしてよろしいでしょうか。';
const rect = sel => `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height}})()`;
const pad = (a, p) => ({ x: Math.max(0, a.x - p), y: Math.max(0, a.y - p), width: a.w + p * 2, height: a.h + p * 2 });
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

(async () => {
  const b = await launch(9441);
  await b.send('Network.enable');
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  await b.open(ORIGIN, 560, 1200, 2, true, 'light');
  await b.ev(`[...document.querySelectorAll('button')].find(x=>x.textContent==='例文を入れる').click()`); await b.sleep(400);
  // ①の見出し「置き換える所」〜印の付いた文
  const h3 = await b.ev(rect('#h-s1 ~ h3')), pv = await b.ev(rect('#preview'));
  await b.shot(path.join(OUT, '01-x-primary.png'), pad(union(h3, pv), 12));
  // ②の段
  await b.shot(path.join(OUT, '02-masked.png'), pad(await b.ev(rect('#h-s2')).then(() => b.ev(rect('section[aria-labelledby=h-s2]'))), 8));
  // ③ デスクトップ: 右の列が切れないよう縦に長い画面で撮る
  await b.open(ORIGIN, 1000, 2400, 2, false, 'light');
  await b.ev(`[...document.querySelectorAll('button')].find(x=>x.textContent==='例文を入れる').click()`); await b.sleep(300);
  await b.ev(`(()=>{const e=document.getElementById('reply');e.value=${JSON.stringify(REPLY)};e.dispatchEvent(new Event('input'))})()`); await b.sleep(400);
  const s3 = await b.ev(rect('section[aria-labelledby=h-s3]')), lay = await b.ev(rect('.layout'));
  await b.shot(path.join(OUT, '03-restored-desktop.png'), { x: lay.x - 8, y: s3.y - 8, width: lay.w + 16, height: s3.h + 16 });
  await b.shot(path.join(OUT, '04-desktop-full.png'), { x: 0, y: 0, width: 1000, height: await b.ev('document.documentElement.scrollHeight') });
  console.log(JSON.stringify({ h3, pv, s3 }));
  b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });

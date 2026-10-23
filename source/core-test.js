// 純ロジックの検算。実行: node source/core-test.js
// index.html の <script id="core"> を取り出して読み込み、検出・伏せる・戻す・往復を確かめる
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = { module: { exports: {} }, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const MR = ctx.module.exports;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log('NG', name, '\n  got ', g, '\n  want', w); }
}
const run = (text, manual, offs) => {
  const cands = MR.detect(text);
  const terms = MR.buildTerms(text, cands, manual || [], offs || {});
  return { cands, terms, m: MR.mask(text, terms, false) };
};
// 重なりで負けた候補は detect には残るが、文中に出てこなければ buildTerms で落ちる。利用者に見える一覧(terms)で比べる
const kinds = text => run(text).terms.map(t => t.kind + ':' + t.value);

// S1 Card1のサンプル
const r1 = run(MR.SAMPLE);
eq('S1 masked', r1.m.text,
  'はじめまして、【会社A】の【お客様A】と申します。\n来月の社内研修で、パンフレットの撮影をお願いできないかと思いご連絡しました。\n会場は 【住所1】 の3階です。\nご都合を、【お客様B】様宛てではなく担当の【お客様C】さんにご返信ください。\n連絡先: 【メール1】 / 【電話1】');
eq('S1 count', r1.m.count, 7);
eq('S1 prefix', MR.mask(MR.SAMPLE, r1.terms, true).text.indexOf(MR.PREFIX + '\n\n'), 0);

// S2 往復: 伏せた文をそのまま返事として貼ると元の文に戻る
function roundTrip(name, text, manual) {
  const r = run(text, manual);
  const back = MR.restore(r.m.text, r.terms);
  eq('S2 ' + name, back.text, text);
  eq('S2 ' + name + ' count', back.count, r.m.count);
}
roundTrip('sample', MR.SAMPLE);
roundTrip('emoji/surrogate', '😀𠮷野家の山田 太郎様へ。\tタブ;カンマ,バックスラッシュ\\ 全角！？　「鈴木さん」\r\n改行 090-1111-2222 😀');
roundTrip('manual words', '店名はカフェ・サンプルです。カフェ・サンプルの田中より', [{ value: 'カフェ・サンプル', kind: 'company' }, { value: '田中', kind: 'person' }]);

// S3 崩れた記号
const t3 = r1.terms;
const R = s => MR.restore(s, t3);
eq('S3 全角', R('【お客様Ａ】様').text, '山田 花子様');
eq('S3 かぎ括弧', R('「お客様A」様').text, '山田 花子様');
eq('S3 角括弧', R('[お客様A]様と［お客様B］様').text, '山田 花子様と山田様');
eq('S3 括弧なし', R('お客様C様、ご連絡ありがとうございます').text, '佐藤様、ご連絡ありがとうございます');
eq('S3 小文字', R('お客様c様').text, '佐藤様');
eq('S3 片側', R('【お客様A様').text, '山田 花子様');
eq('S3 番号の括弧なしは戻さない', R('電話1 にご連絡').text, '電話1 にご連絡');
eq('S3 番号の括弧あり', R('【電話1】・［メール1］').text, '090-0000-1234・hanako@example.com');
eq('S3 未知の記号', R('【お客様AB】様と【電話9】').unknown, ['【お客様AB】', '【電話9】']);
eq('S3 未知の記号は戻さない', R('【お客様AB】様').text, '【お客様AB】様');
eq('S3 空白を飲み込まない', R('会場は 【住所1】 の3階').text, '会場は 東京都架空区見本町1-2-3 の3階');
eq('S3 使われなかった記号', R('【お客様A】様').unused.map(t => t.token), ['【会社A】', '【住所1】', '【お客様B】', '【お客様C】', '【メール1】', '【電話1】']);
eq('S3 様様(値に敬称が入っている)', MR.restore('【お客様A】様', run('山田様へ', [{ value: '山田様', kind: 'person' }]).terms).doubled, ['山田様様']);
eq('S3 様様(さん)', MR.restore('【お客様A】さん', run('佐藤さんへ', [{ value: '佐藤さん', kind: 'person' }]).terms).doubled, ['佐藤さんさん']);
// 27人目以降の記号
eq('letters', [0, 25, 26, 27, 51, 52].map(MR.letters), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
const many = Array.from({ length: 28 }, (_, i) => '人' + '一二三四五六七八九十'.charAt(i % 10) + String.fromCharCode(0x30A2 + i * 2) + '様').join('、');
const rm = run(many);
eq('S3 28人目は AB', rm.terms.filter(t => t.kind === 'person').map(t => t.inner).slice(-2), ['お客様AA', 'お客様AB']);
eq('S3 AAとAの混在', MR.restore('【お客様AA】と【お客様A】', rm.terms).text, rm.terms[26].value + 'と' + rm.terms[0].value);

// S4 誤検出しないこと
['お客様各位', '皆様', '皆さん', 'お母さん', '奥さん', 'ご担当者様', '2026-10-24', '14:00', '3,980円', 'v1.2.3', '第2版', '前回同様に', '仕様どおり', 'お店の様子', 'ユーザー様', 'オーナー様', 'スタッフさん', '先生', '東京都内', 'お客様へ']
  .forEach(w => eq('S4 ' + w, kinds('テスト ' + w + ' です'), []));
eq('S4 担当の佐藤さん', kinds('担当の佐藤さんへ'), ['person:佐藤']);
eq('S4 弊社担当佐藤様', kinds('弊社担当佐藤様'), ['person:佐藤']);
eq('S4 店名＋様は会社', kinds('サンプル商事様'), ['company:サンプル商事']);

// S5 取りこぼし(拾えなくてよい)と手で足す
eq('S5 敬称なし', kinds('田中から連絡します'), []);
eq('S5 都道府県なし', kinds('架空区見本町1-2-3'), []);
eq('S5 手で足す', run('田中から連絡します。田中です', [{ value: '田中', kind: 'person' }]).m.text, '【お客様A】から連絡します。【お客様A】です');

// S6 長い順の置き換え
const r6 = run('山田花子と山田と花子', [{ value: '山田', kind: 'person' }, { value: '花子', kind: 'person' }, { value: '山田花子', kind: 'person' }]);
eq('S6 longest first', r6.m.text, '【お客様A】と【お客様B】と【お客様C】');
roundTrip('S6 roundtrip', '山田花子と山田と花子', [{ value: '山田', kind: 'person' }, { value: '花子', kind: 'person' }, { value: '山田花子', kind: 'person' }]);

// S7 連絡先・番号
eq('S7 contacts', kinds('メール taro@example.com 電話 03-0000-0000 携帯 ０９０－００００－００００ 〒000-0000 https://example.com/inquiry/0000 カード 4111 1111 1111 1111 口座番号 1234567 site example.jp +81-90-0000-0000'),
  ['email:taro@example.com', 'phone:03-0000-0000', 'phone:０９０－００００－００００', 'zip:〒000-0000', 'url:https://example.com/inquiry/0000', 'number:4111 1111 1111 1111', 'number:1234567', 'url:example.jp', 'phone:+81-90-0000-0000']);
eq('S7 日付・金額は拾わない', kinds('2026-10-24 2026/10/24 12:30 1,234,567円 3.14159265'), []);
eq('S7 住所', kinds('〒000-0000 大阪府架空市見本1丁目2番3号 サンプルビル'), ['zip:〒000-0000', 'address:大阪府架空市見本1丁目2番3号']);
eq('S7 会社', kinds('サンプル株式会社と（株）見本と合同会社テスト'), ['company:サンプル株式会社', 'company:（株）見本', 'company:合同会社テスト']);
eq('S7 署名', kinds('氏名：山田 花子\n担当: 佐藤'), ['person:山田 花子', 'person:佐藤']);

// 切り替え: 伏せないにしても他の記号は変わらない
const r8 = run(MR.SAMPLE, [], { '山田 花子': 1 });
eq('toggle keeps tokens', r8.terms.filter(t => t.on).map(t => t.token), ['【会社A】', '【住所1】', '【お客様B】', '【お客様C】', '【メール1】', '【電話1】']);
eq('toggle count', r8.m.count, 6);

// S8 XSSの文字列は文字のまま扱う(表示はtextContent。ここでは往復が壊れないことだけ)
roundTrip('S8 xss', '<img src=x onerror=alert(1)>山田様"><script>alert(1)</script>');

// S12 10,000字
const big = (MR.SAMPLE + '\n').repeat(60).slice(0, 10000);
let t0 = Date.now(); const rb = run(big); const back = MR.restore(rb.m.text, rb.terms); const ms = Date.now() - t0;
eq('S12 roundtrip', back.text, big);
console.log('S12 10,000字 伏せる+戻す: ' + ms + 'ms');
eq('peek', [MR.peek('山田 花子'), MR.peek('林'), MR.peek('ab')], ['山＊＊＊子', '林＊', 'a＊']);

// ---- レビュー①の指摘 ----
// 🔴1 伏せた後に①を変えても、記号は別の人に付け替わらない
{
  const book = MR.newBook();
  const t1 = MR.buildTerms('担当の佐藤さんと山田様', MR.detect('担当の佐藤さんと山田様'), [], {}, book);
  eq('R1 before', MR.mask('担当の佐藤さんと山田様', t1, false).text, '担当の【お客様A】さんと【お客様B】様');
  const text2 = '鈴木さん経由で担当の佐藤さんと山田様';
  const t2 = MR.buildTerms(text2, MR.detect(text2), [], {}, book);
  eq('R1 after edit restore', MR.restore('【お客様A】に連絡', t2).text, '佐藤に連絡');
  eq('R1 new person gets C', MR.mask(text2, t2, false).text, '【お客様C】さん経由で担当の【お客様A】さんと【お客様B】様');
  // 文から消えた人の記号も戻せる
  const t3 = MR.buildTerms('山田様', MR.detect('山田様'), [], {}, book);
  eq('R1 removed person still restores', MR.restore('【お客様A】と【お客様B】', t3).text, '佐藤と山田');
}
// 🔴2 前後の括弧を片側だけ飲み込まない
{
  const t = run('山田様へ').terms;
  eq('R2 開きかぎ', MR.restore('件名「お客様A様へのご案内」です', t).text, '件名「山田様へのご案内」です');
  eq('R2 開き丸', MR.restore('（お客様A様）', t).text, '（山田様）');
  eq('R2 閉じかぎ', MR.restore('彼は「ありがとう、お客様A」と言った', t).text, '彼は「ありがとう、山田」と言った');
  const ta = run('東京都港区芝公園1-2-3').terms;
  eq('R2 番号の開き丸だけ', MR.restore('（住所1、です', ta).text, '（住所1、です');
  eq('R2 番号の対の丸', MR.restore('（住所1）です', ta).text, '東京都港区芝公園1-2-3です');
  eq('R2 【だけ', MR.restore('【住所1です', ta).text, '東京都港区芝公園1-2-3です');
  eq('R2 】だけ', MR.restore('住所1】です', ta).text, '東京都港区芝公園1-2-3です');
  eq('R2 対のかぎ', MR.restore('「お客様A」様', t).text, '山田様');
}
// 🟡3 重なりで負けた名前も、外に出てくれば伏せる
eq('R3', run('株式会社サンプル商事営業部山田太郎様宛。山田太郎です').m.text.indexOf('山田太郎'), -1);
// 🟡4 伏せないにした言葉の中の、手で足した言葉は伏せる
{
  const r = run('山田 花子様', [{ value: '花子', kind: 'person' }], { '山田 花子': 1 });
  eq('R4 masked', r.m.text, '山田 【お客様A】様');
  eq('R4 count', r.terms.filter(t => t.value === '花子')[0].count, 1);
}
// 🟡8 元の文にもともと「会社A」があると、括弧なしでは戻さない
{
  const r = run('株式会社テスト商事です。比較表の会社Aと会社Bを見てください');
  eq('R8 collisions', r.m.collisions, ['会社A']);
  eq('R8 bare not restored', MR.restore('会社Aと会社Bを比べると', r.terms).text, '会社Aと会社Bを比べると');
  eq('R8 bracket restored', MR.restore('【会社A】と会社B', r.terms).text, '株式会社テスト商事と会社B');
}
// 🟡9 対応表にない括弧なしの文字記号にも注意
eq('R9', MR.restore('お客様AB様', run('山田様へ').terms).unknown, ['お客様AB']);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

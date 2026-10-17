import {inspectArticle,amazonStep} from '../extension/core.js';
const results=document.querySelector('#results'),summary=document.querySelector('#summary'),frame=document.querySelector('#fixture');
const jp='この研究では、液滴の動きと表面の性質を調べました。実験結果により、液体の移動と表面構造の関係が明らかになりました。測定値は図に示されています。';
const en='This study investigates droplet movement and the properties of structured surfaces. Experimental results demonstrate the relationship between liquid motion and the surface structure.';
const wrap=`<div id="s2k-home-wrapper"><div id="s2k-dnd-container">Drop here</div><div id="ready-2-send" style="display:none"><div id="s2k-r2s-file-list"><div><input type="text" value="論文_日本語"></div></div><label id="s2k-r2s-add2lib"><input type="checkbox"></label><button id="s2k-r2s-send-button">送信</button></div><div id="s2k-r2s-error-overview" style="display:none">Error</div><div id="s2k-dnd-files-on-the-way-header" style="display:none">ファイルは処理中です</div></div>`;
function fixture(html){const d=frame.contentDocument;d.open();d.write('<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>');d.close();return d;}
function article(){return frame.contentWindow.eval('('+inspectArticle.toString()+')')();}
function amazon(action,payload={},origin='https://www.amazon.co.jp'){return new frame.contentWindow.Function('location','return ('+amazonStep.toString()+')')({origin,pathname:'/sendtokindle'})(action,payload);}
function assert(v,m='Assertion failed'){if(!v)throw new Error(m);}
const tests=[
 ['日本語の本文を認識する',()=>{fixture(`<article><p>${jp}</p><p>${jp}</p></article>`);assert(article().ready);}],
 ['メニューだけ日本語・本文は英語なら停止',()=>{fixture(`<nav>${jp}</nav><article><p>${en}</p><p>${en}</p></article>`);assert(!article().ready);}],
 ['翻訳途中の本文では印刷しない',()=>{fixture(`<article><p>${jp}</p><p>${en}</p><p>${en}</p></article>`);assert(!article().ready);}],
 ['参考文献の英語は本文の翻訳率から除く',()=>{fixture(`<article><p>${jp}</p><p>${jp}</p><section id="references"><p>${en}</p><p>${en}</p></section></article>`);assert(article().ready);}],
 ['PDFビューアーを拒否する',()=>{fixture('<embed type="application/pdf">');assert(article().pdf);}],
 ['Amazon以外にはPDFを渡さない',()=>{fixture(wrap);assert(amazon('drop',{},'https://evil.test').state==='login');}],
 ['PDFをドラッグ＆ドロップで投入する',()=>{const d=fixture(wrap);let count=0;d.querySelector('#s2k-dnd-container').addEventListener('drop',e=>{count++;assert(e.dataTransfer.files[0].name==='論文_日本語.pdf');assert(e.dataTransfer.files[0].type==='application/pdf');});assert(amazon('drop',{data:btoa('%PDF-1.4\n test'),filename:'論文_日本語.pdf'}).state==='error','Existing queue must block');d.querySelector('#s2k-r2s-file-list').replaceChildren();assert(amazon('drop',{data:btoa('%PDF-1.4\n test'),filename:'論文_日本語.pdf'}).state==='dropped');assert(count===1);}],
 ['別ファイルの送信を防ぐ',()=>{const d=fixture(wrap);d.querySelector('#ready-2-send').style.display='block';assert(amazon('send',{filename:'別の論文.pdf',jobId:'1'}).state==='error');}],
 ['ライブラリ追加をオンにし、送信は一度だけ',()=>{const d=fixture(wrap);d.querySelector('#ready-2-send').style.display='block';let n=0;d.querySelector('button').onclick=()=>n++;const payload={filename:'論文_日本語.pdf',jobId:'one'};assert(amazon('send',payload).state==='sending');assert(d.querySelector('input[type=checkbox]').checked);amazon('send',payload);assert(n===1);}],
 ['処理中表示をAmazon受付として区別する',()=>{const d=fixture(wrap);d.querySelector('#s2k-dnd-files-on-the-way-header').style.display='block';assert(amazon('inspect').state==='accepted');}],
 ['Amazonのエラー表示を成功扱いしない',()=>{const d=fixture(wrap);d.querySelector('#s2k-r2s-error-overview').style.display='block';assert(amazon('inspect').state==='error');}]
];
document.querySelector('#run').onclick=async()=>{results.replaceChildren();let pass=0;for(const [name,fn]of tests){const li=document.createElement('li');try{await fn();pass++;li.textContent='✓ '+name;}catch(e){li.textContent='✗ '+name+' — '+e.message;li.style.color='#a02020';}results.append(li);}summary.textContent=`${pass} / ${tests.length} 件 成功`;document.title=`${pass}/${tests.length} tests — 論文をKindleへ`;};

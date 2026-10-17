export const AMAZON = 'https://www.amazon.co.jp/sendtokindle';
export const DEFAULTS = {configured:false, paper:'A4', autoSend:true, translationTimeout:180};
export function isArticleURL(value) {
  try { const u=new URL(value); return ['https:','http:'].includes(u.protocol) && !u.pathname.toLowerCase().endsWith('.pdf') && !(u.hostname==='www.amazon.co.jp' && u.pathname.startsWith('/sendtokindle')); } catch {return false;}
}
export function isAmazonURL(value) {
  try {const u=new URL(value);return u.origin==='https://www.amazon.co.jp' && /^\/sendtokindle\/?$/.test(u.pathname);}catch{return false;}
}
export function safeFilename(title) {
  return (title || '論文').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,110) + '_日本語.pdf';
}
export function printOptions(paper) {
  const sizes={A4:[8.2677,11.6929],A5:[5.8268,8.2677]};const [paperWidth,paperHeight]=sizes[paper]||sizes.A4;
  return {paperWidth,paperHeight,printBackground:true,displayHeaderFooter:false,marginTop:0.32,marginBottom:0.32,marginLeft:0.32,marginRight:0.32,preferCSSPageSize:false,transferMode:'ReturnAsBase64'};
}
export function validPDF(data) {return typeof data==='string' && data.startsWith('JVBERi0') && data.length>100;}
export const delay=ms=>new Promise(r=>setTimeout(r,ms));

// Self-contained: runs in the article's main world. No page text leaves this tab.
export function inspectArticle() {
  if(document.contentType==='application/pdf' || document.querySelector('embed[type="application/pdf"]'))return {pdf:true};
  const roots=[...document.querySelectorAll('article,main,[role="main"]')];
  const root=roots.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0]||document.body;
  if(!root)return {ready:false,reason:'本文を読み込み中'};
  const visible=e=>!!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
  const paras=[...root.querySelectorAll('p')].filter(e=>visible(e)&&!e.closest('nav,footer,aside,[role="navigation"],[id*="reference"],[id*="bibliograph"],.references'));
  const texts=paras.map(e=>e.innerText.trim()).filter(t=>t.length>=70);
  const jp=t=>(t.match(/[ぁ-んァ-ヶ]/g)||[]).length>=5;
  const eligible=texts.filter(t=>jp(t)||(t.match(/[A-Za-z]/g)||[]).length>40);
  const translated=eligible.filter(jp).length;
  const ratio=eligible.length?translated/eligible.length:0;
  const text=eligible.join('\n');let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  const pending=[...root.querySelectorAll('img')].filter(e=>visible(e)&&e.currentSrc&&!e.complete).length;
  return {ready:eligible.length>=2 && translated>=2 && ratio>=.8 && !pending && document.fonts.status==='loaded',ratio,translated,paragraphs:eligible.length,pending,hash:hash>>>0,title:document.title,url:location.href,height:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),viewport:innerHeight,x:scrollX,y:scrollY};
}

// Self-contained adapter; selectors verified against the Japanese Send to Kindle page.
export function amazonStep(action, payload={}) {
  const onAmazon=location.origin==='https://www.amazon.co.jp' && /^\/sendtokindle\/?$/.test(location.pathname);
  if(!onAmazon)return {state:'login',message:'Amazon.co.jpにログインして、Send to Kindle画面に戻ってください。'};
  const visible=e=>!!e && !!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
  const root=document.querySelector('#s2k-home-wrapper');
  const drop=document.querySelector('#s2k-dnd-container');
  const list=document.querySelector('#s2k-r2s-file-list');
  const send=document.querySelector('#s2k-r2s-send-button');
  const checkbox=document.querySelector('#s2k-r2s-add2lib input[type="checkbox"]');
  const error=document.querySelector('#s2k-dnd-upload-error-modal-content-text');
  const overview=document.querySelector('#s2k-r2s-error-overview');
  if(visible(error)&&error.textContent.trim())return {state:'error',message:error.textContent.trim()};
  if(visible(overview))return {state:'error',message:overview.textContent.trim()};
  if(!root || !drop)return {state:'loading'};
  if(action==='drop') {
    if(!visible(drop))return {state:'error',message:'新しい送信画面ではありません。PDFは保持しています。'};
    if(list?.children.length)return {state:'error',message:'別のファイルがあるため自動送信を停止しました。'};
    if(!payload.data?.startsWith('JVBERi0') || !/\.pdf$/i.test(payload.filename))throw new Error('PDFのデータが不正です');
    const bytes=Uint8Array.from(atob(payload.data),c=>c.charCodeAt(0));
    const dt=new DataTransfer();dt.items.add(new File([bytes],payload.filename,{type:'application/pdf'}));
    for(const type of ['dragenter','dragover','drop'])drop.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
    return {state:'dropped'};
  }
  if(visible(send)) {
    if(!list || !list.children.length)return {state:'loading'};
    if(list.children.length!==1)return {state:'error',message:'送信待ちファイルが1件ではないため停止しました。Amazon画面で確認してください。'};
    // This fresh tab belongs to one job. Never send unrelated queued files.
    const names=[...list.querySelectorAll('input[type="text"]')].map(e=>e.value);
    const content=list.textContent+' '+names.join(' ');
    const stem=(payload.filename||'').replace(/\.pdf$/i,'');
    if(!stem || !content.includes(stem))return {state:'error',message:'送信待ちファイルの名前を照合できません。Amazon画面で確認してください。'};
    if(!checkbox)return {state:'error',message:'「ライブラリに追加する」を確認できません。'};
    if(action==='send') {
      if(!checkbox.checked)checkbox.click();
      if(!checkbox.checked)return {state:'error',message:'ライブラリへの追加を有効にできませんでした。'};
      if(send.disabled || send.getAttribute('aria-disabled')==='true')return {state:'loading'};
      if(document.documentElement.dataset.paperKindleSent===payload.jobId)return {state:'sending'};
      document.documentElement.dataset.paperKindleSent=payload.jobId;
      send.click();return {state:'sending'};
    }
    return {state:'ready',library:checkbox.checked};
  }
  const processing=document.querySelector('#s2k-dnd-files-on-the-way-header');
  if(visible(processing))return {state:'accepted',message:processing.textContent.trim()};
  if(visible(drop))return {state:'empty'};
  return {state:'loading'};
}

import {AMAZON,DEFAULTS,isArticleURL,isAmazonURL,safeFilename,printOptions,validPDF,delay,inspectArticle,amazonStep} from './core.js';
import {savePDF,readPDF,clearPDF} from './db.js';
let running=null;
const terminals=new Set(['accepted','error','paused','downloaded']);
async function update(patch){const {job={}}=await chrome.storage.local.get('job');const next={...job,...patch,updated:Date.now()};await chrome.storage.local.set({job:next});await chrome.action.setBadgeText({text:next.state==='accepted'?'OK':terminals.has(next.state)?'!':'…'});await chrome.action.setBadgeBackgroundColor({color:next.state==='accepted'?'#216454':'#52657a'});return next;}
async function settings(){return {...DEFAULTS,...(await chrome.storage.local.get('settings')).settings};}
async function statusTab(active=false){return chrome.tabs.create({url:chrome.runtime.getURL('status.html'),active});}
async function evaluate(tabId,fn,args=[]){const {result,exceptionDetails}=await chrome.debugger.sendCommand({tabId},'Runtime.evaluate',{expression:`(${fn.toString()})(...${JSON.stringify(args)})`,returnByValue:true,awaitPromise:true});if(exceptionDetails)throw new Error(exceptionDetails.exception?.description||exceptionDetails.text);return result?.value;}
async function checkCancelled(job){if(job.cancelled)throw new Error('処理を停止しました。');const t=await chrome.tabs.get(job.sourceTab);if(t.url!==job.url)throw new Error('元のタブが別のページへ移動したため停止しました。');}
async function waitTranslation(job,options){
  let info=await evaluate(job.sourceTab,inspectArticle);if(info.pdf)throw new Error('PDF表示ではなく、出版社の論文本文のWebページを開いてください。');
  const original={x:info.x,y:info.y};
  try {
    await update({state:'loading',message:'本文と図を読み込んでいます。ページが自動でスクロールします。'});
    let reached=false;
    for(let i=0;i<120;i++){
      await checkCancelled(job);
      const pos=await evaluate(job.sourceTab,()=>({y:scrollY,h:document.documentElement.scrollHeight,v:innerHeight}));
      if(pos.y+pos.v>=pos.h-4){reached=true;break;}
      await evaluate(job.sourceTab,()=>window.scrollBy(0,Math.max(200,innerHeight*.8)));await delay(180);
    }
    if(!reached)throw new Error('ページが長すぎるか無限スクロールです。本文だけを開いて再実行してください。');
    await update({state:'translation',message:'Chromeの日本語訳を待っています。未翻訳の場合は、このタブで「日本語に翻訳」を選んでください。'});
    let hash=null;let stable=Date.now();const deadline=Date.now()+options.translationTimeout*1000;
    while(Date.now()<deadline){
      await checkCancelled(job);info=await evaluate(job.sourceTab,inspectArticle);
      if(info.hash!==hash || !info.ready){hash=info.hash;stable=Date.now();}
      if(info.ready && Date.now()-stable>=4000)return info;
      await delay(800);
    }
    throw new Error('日本語訳の完了を確認できませんでした。Chromeの「英語を常に翻訳」を設定するか、本文を日本語に翻訳してから再実行してください。英語のまま送信はしていません。');
  } finally {await evaluate(job.sourceTab,({x,y})=>window.scrollTo(x||0,y||0),[original]).catch(()=>{});}
}
async function amazonCall(tabId,action,payload){const tab=await chrome.tabs.get(tabId);if(!isAmazonURL(tab.url))return {state:'login'};const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:amazonStep,args:[action,payload]});return result[0]?.result||{state:'loading'};}
async function deliver(file,job,options){
  const tab=await chrome.tabs.create({url:AMAZON,active:true});job.amazonTab=tab.id;
  await update({state:'amazon',amazonTab:tab.id,message:'Amazonの送信画面を開いています。ログインが必要な場合は、この画面でログインしてください。'});
  let dropped=false,clicked=false;const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    if(job.cancelled){await update({state:'paused',message:clicked?'送信操作後に監視を停止しました。Amazon側の処理は続く場合があります。':'停止しました。PDFは保存されています。'});return;}
    let r=await amazonCall(tab.id,'inspect',{filename:file.filename,jobId:job.id});
    if(r.state==='error')throw new Error(r.message);
    if(r.state==='empty'&&!dropped){
      r=await amazonCall(tab.id,'drop',{data:file.data,filename:file.filename});
      if(r.state==='error')throw new Error(r.message);
      dropped=true;await update({state:'upload',message:'PDFをAmazonの送信画面に渡しました。送信準備を確認しています。'});
    } else if(r.state==='ready'&&dropped&&!clicked){
      if(!options.autoSend){await update({state:'paused',message:'PDFの準備ができました。Amazon画面の「ライブラリに追加する」をオンにし、「送信」を押してください。'});return;}
      // Persist intent BEFORE clicking. Never automatically retry an ambiguous submission.
      await update({state:'sending',sendAttempted:true,message:'ライブラリへの追加をオンにして送信しています。'});
      const sent=await amazonCall(tab.id,'send',{filename:file.filename,jobId:job.id});
      if(sent.state==='error')throw new Error(sent.message);
      if(sent.state==='sending')clicked=true;
    } else if(r.state==='accepted'&&dropped){
      await update({state:'accepted',message:'Amazonがファイルを受け付けました。ライブラリへの反映・Kindleへの配信はAmazon側で処理中です。端末での閲覧完了は未確認です。'});return;
    }
    await delay(1000);
  }
  throw new Error(clicked?'送信後の完了表示を確認できませんでした。重複を避けるため自動再送はしません。Amazonの「最近送信したファイル」を確認してください。':'Amazon画面で処理が進みませんでした。PDFは残っています。状況画面から保存して手動で送信できます。');
}
export async function start(tab){
  if(running){await statusTab(true);return;}
  const opts=await settings();if(!opts.configured){await chrome.runtime.openOptionsPage();return;}
  if(!isArticleURL(tab?.url)){await chrome.storage.local.set({job:{state:'error',message:'論文本文のWebページを開いてから押してください。PDFビューアー・Chrome設定画面では実行できません。'}});await statusTab(true);return;}
  const permissions=await chrome.permissions.contains({origins:['https://www.amazon.co.jp/*']});
  if(!permissions){await chrome.runtime.openOptionsPage();return;}
  const previous=(await chrome.storage.local.get('job')).job;
  if(previous?.url===tab.url && (previous.sendAttempted||previous.state==='accepted')){await statusTab(true);return;}
  const job={id:crypto.randomUUID(),sourceTab:tab.id,url:tab.url,cancelled:false};running=job;let attached=false;
  await chrome.storage.local.set({job:{...job,state:'starting',message:'準備しています。'}});await statusTab(false);
  try {
    await chrome.debugger.attach({tabId:tab.id},'1.3');attached=true;
    const info=await waitTranslation(job,opts);await checkCancelled(job);
    await update({state:'printing',message:'翻訳後のページをChromeの印刷機能でPDFにしています。'});
    const {data}=await chrome.debugger.sendCommand({tabId:tab.id},'Page.printToPDF',printOptions(opts.paper));
    if(!validPDF(data))throw new Error('Chromeから有効なPDFを取得できませんでした。');
    if(data.length*.75>190*1024*1024)throw new Error('PDFが大きすぎます。本文を短くするか手動印刷で保存してください。');
    const file={data,filename:safeFilename(info.title),url:job.url,created:Date.now(),jobId:job.id};await savePDF(file);await update({filename:file.filename,hasPDF:true});
    if(data.length*.75>32*1024*1024)throw new Error('PDFが32MBを超えました。自動転送を止めましたが、PDFは保存されています。「PDFを保存」から取り出し、Amazonへ手動で送信してください。');
    await chrome.debugger.detach({tabId:tab.id});attached=false;
    if(job.cancelled)throw new Error('処理を停止しました。PDFは保存されています。');
    await deliver(file,job,opts);
  }catch(e){await update({state:'error',message:String(e.message||e)});await statusTab(true);}
  finally {if(attached)await chrome.debugger.detach({tabId:tab.id}).catch(()=>{});running=null;}
}
chrome.action.onClicked.addListener(tab=>{start(tab).catch(async e=>{running=null;await update({state:'error',message:e.message});});});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  // Only extension pages may control a job. No externally_connectable or content-script listeners.
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))return;
  (async()=>{
    if(msg.type==='cancel'){if(running)running.cancelled=true;return {ok:true};}
    if(msg.type==='download'){const f=await readPDF();if(!f)throw new Error('保存済みPDFはありません');await chrome.downloads.download({url:'data:application/pdf;base64,'+f.data,filename:f.filename,saveAs:true});return {ok:true};}
    if(msg.type==='clear'){if(running)throw new Error('処理中は消去できません');await clearPDF();await chrome.storage.local.remove('job');await chrome.action.setBadgeText({text:''});return {ok:true};}
    if(msg.type==='running')return {active:!!running};
    throw new Error('不明な操作です');
  })().then(respond,e=>respond({error:e.message}));return true;
});
chrome.runtime.onInstalled.addListener(()=>chrome.runtime.openOptionsPage());
chrome.runtime.onStartup.addListener(async()=>{const {job}=await chrome.storage.local.get('job');if(job&&!terminals.has(job.state))await update({state:'paused',message:'Chromeの再起動で停止しました。自動再送はしていません。送信済みかAmazon画面で確認してください。'});});

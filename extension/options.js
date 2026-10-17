import {DEFAULTS} from './core.js';
const $=id=>document.getElementById(id);const opts={...DEFAULTS,...(await chrome.storage.local.get('settings')).settings};
$('paper').value=opts.paper;$('autoSend').checked=opts.autoSend;$('ready').checked=opts.configured;
$('save').addEventListener('click',async()=>{
  try{
    if(!$('ready').checked)throw new Error('初回設定を済ませてからチェックを入れてください。');
    const granted=await chrome.permissions.request({origins:['https://www.amazon.co.jp/*']});
    if(!granted)throw new Error('Amazonの送信画面を操作する許可が必要です。');
    await chrome.storage.local.set({settings:{...DEFAULTS,configured:true,paper:$('paper').value,autoSend:$('autoSend').checked}});
    $('feedback').textContent='保存しました。論文のWebページに戻り、拡張のアイコンを1回押してください。';
  }catch(e){$('feedback').textContent=e.message;}
});

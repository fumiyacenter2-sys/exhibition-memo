// Local-first recording and authenticated, retryable Drive backup.
const syncSettingsKey = 'exhibition-drive-settings';
// Preserve old credentials separately; neither new account inherits them.
const profilesKey = 'exhibition-drive-profiles-v1';
let profiles = JSON.parse(localStorage.getItem(profilesKey) || '{"work":{},"personal":{}}');
let activeMode = localStorage.getItem('exhibition-mode') === 'personal' ? 'personal' : 'work';
let recordingMode = null;
const modeLabels = {work:'仕事',personal:'私用'};
const modeAccounts = {work:'peroteramoto',personal:'janpicard'};
let settingsMode = activeMode;
let driveSettings = profiles[activeMode];
const modeBar=document.createElement('div');
modeBar.id='mode-bar';
modeBar.innerHTML='<button data-mode="work">仕事 · peroteramoto</button><button data-mode="personal">私用 · janpicard</button>';
document.getElementById('screen-rec').prepend(modeBar);
function updateModeUI(){
 document.body.dataset.mode=activeMode;
 modeBar.querySelectorAll('button').forEach(button=>{
   button.setAttribute('aria-pressed',String(button.dataset.mode===activeMode));
   button.disabled=!!recordingMode;
 });
 document.querySelector('#list-header h2').textContent=modeLabels[activeMode]+'のクリップ';
 document.getElementById('clear-btn').textContent=modeLabels[activeMode]+'を全削除';
 document.querySelector('#clear-dialog p').textContent=modeLabels[activeMode]+'の端末内動画をすべて削除しますか？未同期の動画も消えます。ドライブ内の動画は残ります。';
}
async function getModeKeys(mode=activeMode){
 return new Promise((resolve,reject)=>{
   const keys=[],tx=db.transaction(STORE,'readonly');
   const req=tx.objectStore(STORE).openCursor();
   req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;if((cursor.value.mode || 'work')===mode)keys.push(cursor.key);cursor.continue();};
   tx.oncomplete=()=>resolve(keys);tx.onerror=()=>reject(tx.error);
 });
}
async function refreshModeCount(){
 if(!db)return;
 const mode=activeMode,keys=await getModeKeys(mode);
 if(activeMode===mode){clipCount=keys.length;countLabel.textContent=modeLabels[mode]+' · '+clipCount+' クリップ';}
}
modeBar.addEventListener('click',async event=>{
 const mode=event.target.dataset.mode;
 if(!mode || recordingMode || mode===activeMode)return;
 activeMode=mode;localStorage.setItem('exhibition-mode',mode);driveSettings=profiles[mode];
 updateModeUI();await refreshModeCount();syncDrive();
});
let syncing = false, recordingStream = null, zoom = 1, paintFrame = 0;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.id = 'zoom-preview';
document.getElementById('camera-wrap').insertBefore(canvas, videoEl.nextSibling);
const zoomBar = document.createElement('div');
zoomBar.id = 'zoom-bar';
zoomBar.innerHTML = '<button id="zoom-less" aria-label="縮小">−</button><span id="zoom-value">1.0×</span><button id="zoom-more" aria-label="拡大">＋</button><button id="drive-settings">保存設定</button>';
document.getElementById('screen-rec').insertBefore(zoomBar, document.getElementById('bottom-bar'));
const statusBar = document.createElement('div');
statusBar.id = 'sync-status';
zoomBar.before(statusBar);
const settings = document.createElement('div');
settings.className = 'dialog'; settings.id = 'drive-dialog';
settings.innerHTML = `<p id="settings-title">Googleドライブへの保存</p>
<label>GASのウェブアプリURL<input id="gas-url" type="url" placeholder="https://script.google.com/macros/s/…/exec"></label>
<label>接続キー<input id="gas-token" type="password" autocomplete="off"></label>
<p style="font-size:12px">空欄でも端末に保存して撮影できます。接続後に送信します。</p>
<div class="btn-row"><button class="btn-ok" id="settings-save">保存して同期</button><button class="btn-cancel" id="settings-close">閉じる</button></div>`;
document.body.append(settings);
// Optional text: empty notes are valid; speech input is the keyboard's own feature.
const noteDialog=document.createElement('div');
noteDialog.id='note-dialog';noteDialog.className='dialog';
noteDialog.setAttribute('role','dialog');noteDialog.setAttribute('aria-modal','true');noteDialog.setAttribute('aria-labelledby','note-title');
noteDialog.innerHTML='<p id="note-title">動画のメモ</p><textarea id="note-input" maxlength="2000" placeholder="空欄でも保存できます。後から入力・修正できます。"></textarea><p style="font-size:12px">キーボードのマイクから音声入力もできます。<br>一覧には冒頭20文字を表示します。</p><p id="note-feedback" role="status"></p><div class="btn-row"><button type="button" id="note-save" class="btn-ok">メモを保存</button><button type="button" id="note-cancel" class="btn-cancel">キャンセル</button></div>';
document.body.append(noteDialog);
let noteTarget=null;
function openClipNote(item,card){
 if(!item.clip)return;
 noteTarget={item,card};
 document.getElementById('note-input').value=item.clip.note ?? item.clip.transcript ?? '';
 document.getElementById('note-title').textContent=modeLabels[item.clip.mode || 'work']+' · '+nameForDisplay(item.clip.filename);
 document.getElementById('note-feedback').textContent='';
 openDialog('note-dialog');document.getElementById('note-input').focus();
}
document.getElementById('note-cancel').onclick=()=>{closeDialog('note-dialog');noteTarget=null;};
document.getElementById('note-save').onclick=async()=>{
 if(!noteTarget)return;
 const {item,card}=noteTarget;
 const note=document.getElementById('note-input').value;
 const noteVersion=crypto.randomUUID();
 const button=document.getElementById('note-save');button.disabled=true;
 document.getElementById('note-cancel').disabled=true;
 try{
   await putClip(item.key,{note,noteVersion});
   item.clip.note=note;item.clip.noteVersion=noteVersion;
   const label=note.replace(/\s+/g,' ').trim();
   card.querySelector('.clip-text').textContent=label ? [...label].slice(0,20).join('')+([...label].length>20?'…':'') : '＋ メモを入力';
   card.querySelector('.clip-text').setAttribute('aria-label',label?'メモを編集：'+label:'メモを入力');card.title=note;
   closeDialog('note-dialog');noteTarget=null;syncDrive();
 }catch(error){document.getElementById('note-feedback').textContent='保存できませんでした。入力は残っています。再度お試しください。';}
 finally{button.disabled=false;document.getElementById('note-cancel').disabled=false;}
};
document.getElementById('drive-settings').onclick = () => {
 settingsMode=activeMode;
 driveSettings=profiles[settingsMode];
 document.getElementById('settings-title').textContent=modeLabels[settingsMode]+'の保存先 · '+modeAccounts[settingsMode];
 document.getElementById('gas-url').value=driveSettings.url || '';
 document.getElementById('gas-token').value=driveSettings.token || '';
 openDialog('drive-dialog');
};
document.getElementById('settings-close').onclick=()=>closeDialog('drive-dialog');
document.getElementById('settings-save').onclick=()=>{
 const url=document.getElementById('gas-url').value.trim(), token=document.getElementById('gas-token').value.trim();
 if(url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { alert('GASの /exec で終わるURLを入力してください');return; }
 const other=profiles[settingsMode==='work'?'personal':'work'];
 if(url && url===other.url){alert('仕事と私用には、それぞれ別のGASのURLを設定してください');return;}
 if(profiles[settingsMode].url && profiles[settingsMode].url!==url && !confirm('今後の未同期動画の保存先を変更します。保存済みの動画は移動しません。よろしいですか？'))return;
 driveSettings={url,token};profiles[settingsMode]=driveSettings;localStorage.setItem(profilesKey,JSON.stringify(profiles));
 closeDialog('drive-dialog');syncDrive();
};
function setZoom(value) { zoom=Math.min(4,Math.max(1,value));document.getElementById('zoom-value').textContent=zoom.toFixed(1)+'×'; }
document.getElementById('zoom-less').onclick=()=>setZoom(zoom-0.2);
document.getElementById('zoom-more').onclick=()=>setZoom(zoom+0.2);
let pinchDistance=0,pinchZoom=1;
const cameraWrap=document.getElementById('camera-wrap');
const distance=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
cameraWrap.addEventListener('touchstart',e=>{if(e.touches.length===2){e.preventDefault();pinchDistance=distance(e.touches);pinchZoom=zoom;}},{passive:false});
cameraWrap.addEventListener('touchmove',e=>{if(e.touches.length===2 && pinchDistance){e.preventDefault();setZoom(pinchZoom*distance(e.touches)/pinchDistance);}},{passive:false});
cameraWrap.addEventListener('touchend',()=>pinchDistance=0);
function drawZoom() {
 if(videoEl.readyState>=2 && videoEl.videoWidth){
   const w=videoEl.videoWidth,h=videoEl.videoHeight;
   if(!mediaRecorder || mediaRecorder.state==='inactive') {
     const width=Math.min(w,1280),height=Math.round(width*h/w);
     if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}
   }
   ctx.drawImage(videoEl,(w-w/zoom)/2,(h-h/zoom)/2,w/zoom,h/zoom,0,0,canvas.width,canvas.height);
 }
 paintFrame=requestAnimationFrame(drawZoom);
}
drawZoom();
const originalStartRec=startRec;
startRec=function(){
 if(!canvas.captureStream){alert('このブラウザはズーム録画に対応していません。ブラウザを更新してください。');return;}
 recordingMode=activeMode;updateModeUI();
 const cameraStream=stream;
 recordingStream=canvas.captureStream(30);
 cameraStream.getAudioTracks().forEach(track=>recordingStream.addTrack(track.clone()));
 stream=recordingStream;
 try { originalStartRec(); } finally { stream=cameraStream; }
 document.getElementById('flip-btn').disabled=true;
 document.getElementById('exit-btn').disabled=true;
};
// Existing click listeners captured the old function; replace the record button listener.
recBtn.removeEventListener('click',originalStartRec);
recBtn.addEventListener('click',startRec);
function putClip(key,changes){
 return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(key);
   req.onsuccess=()=>{if(req.result) store.put({...req.result,...changes},key);};
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
saveToDb=function(blob,filename,mode=recordingMode || activeMode){
 return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   const req=tx.objectStore(STORE).add({blob,filename,mode,downloaded:false,syncId:crypto.randomUUID(),driveId:null});
   tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
};
clipDone=async function(){
 try{
   const mime=chunks[0]?.type || 'video/webm',blob=new Blob(chunks,{type:mime});
   await saveToDb(blob,`記録_${getTimestamp()}_${clipCount+1}_${randStr()}.${getExt(mime)}`);
   await refreshModeCount();
   savedMsg.textContent=modeLabels[recordingMode || activeMode]+' · 端末に保存しました';savedMsg.style.display='block';
   syncDrive();
 }catch(error){
   // Keep chunks in memory and offer a device download if IndexedDB is full.
   autoDownloadToDevice(new Blob(chunks,{type:chunks[0]?.type || 'video/webm'}),`救出_${getTimestamp()}.${getExt(chunks[0]?.type || '')}`);
   alert('端末内への保存に失敗しました。空き容量を確認してください。動画のダウンロードを試みました。');
 }finally{
   recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;
   recordingMode=null;updateModeUI();
   recBtn.classList.remove('recording');recBtn.disabled=false;
   document.getElementById('flip-btn').disabled=false;document.getElementById('exit-btn').disabled=false;
   recBadge.style.display='none';countDown.style.display='none';progressEl.style.width='0%';
 }
};
async function driveCall(payload,target=driveSettings){
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),90000);
 try{
   const response=await fetch(target.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:target.token}),signal:controller.signal,redirect:'follow',credentials:'omit'});
   if(!response.ok)throw Error('通信エラー');
   const data=await response.json();if(!data.ok)throw Error(data.error || '保存失敗');return data;
 }finally{clearTimeout(timeout);}
}
function blobBase64(blob){
 return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>{
     const dataUrl=String(reader.result);
     // MIME codec lists may contain commas (e.g. vp8,opus).
     const marker=';base64,',start=dataUrl.indexOf(marker);
     if(start<0){reject(new Error('動画データを変換できませんでした'));return;}
     resolve(dataUrl.slice(start+marker.length));
   };
   reader.onerror=()=>reject(reader.error || new Error('動画データを読み込めませんでした'));
   reader.readAsDataURL(blob);
 });
}
async function syncDrive(){
 if(syncing || !db)return;
 if(!navigator.onLine){statusBar.textContent='オフライン · 端末に保存して接続後に同期';return;}
 syncing=true;
 try{
   const keys=await getAllKeys();let pending=0,waiting=0;
   for(const key of keys){
     const clip=await readClip(key);if(!clip)continue;
     const notePending=clip.noteVersion && clip.noteVersion!==clip.noteSyncedVersion;
     if(clip.driveId && !notePending)continue;
     const mode=clip.mode || 'work';
     const target={...profiles[mode]};
     if(!target.url || !target.token){waiting++;continue;}
     // Never send an old account's file identifier to a newly selected account.
     if(clip.driveId && clip.driveDestination!==target.url){waiting++;continue;}
     pending++;
     if(!clip.syncId){clip.syncId=crypto.randomUUID();await putClip(key,{syncId:clip.syncId});}
     statusBar.textContent=`${modeLabels[mode]}のドライブへ保存中（${pending}本目）…`;
     try{
       if(clip.driveId){
         const data=await driveCall({action:'note',id:clip.syncId,fileId:clip.driveId,note:clip.note ?? '',noteVersion:clip.noteVersion},target);
         if(data.noteVersion!==clip.noteVersion)throw Error('メモの保存確認に失敗');
         await putClip(key,{noteSyncedVersion:clip.noteVersion});continue;
       }
       const data=await driveCall({action:'upload',id:clip.syncId,name:clip.filename,mime:clip.blob.type,base64:await blobBase64(clip.blob),note:clip.note ?? '',noteVersion:clip.noteVersion || null},target);
       if(!data.id || data.syncId!==clip.syncId)throw Error('保存確認に失敗');
       const changes={driveId:data.id,driveDestination:target.url,mode};
       if(clip.noteVersion && data.noteVersion===clip.noteVersion)changes.noteSyncedVersion=clip.noteVersion;
       else if(clip.noteVersion)waiting++;
       await putClip(key,changes);
     }catch(error){waiting++;}
   }
   statusBar.textContent=waiting?`端末に保存済み · ${waiting}本が同期待ち（各区分の保存設定・通信を確認）`:'ドライブ未同期の動画はありません';
 }catch(error){statusBar.textContent='端末に保存済み · 同期待ち（接続・設定を確認）';}
 finally{syncing=false;}
}
window.addEventListener('online',syncDrive);
window.addEventListener('offline',()=>statusBar.textContent='オフライン · 端末に保存して接続後に同期');
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncDrive();});
setInterval(syncDrive,60000);
// Allow re-downloading even when an older version marked a clip as downloaded.
document.getElementById('player-save-btn').replaceWith(document.getElementById('player-save-btn').cloneNode(true));
document.getElementById('player-save-btn').onclick=()=>{if(currentPlayerItem)downloadSingle(currentPlayerItem);};
const originalOpenPlayer=openPlayer;
openPlayer=function(item,card){originalOpenPlayer(item,card);const button=document.getElementById('player-save-btn');button.textContent='端末にも保存';button.classList.remove('done');};
const exitButton=document.getElementById('exit-btn');
exitButton.replaceWith(exitButton.cloneNode(true));
document.getElementById('exit-btn').onclick=()=>{if(!syncing)doExit();else alert('ドライブへ保存中です。完了を待つか、次回起動時に同期を再開できます。');};
// Deliberate deletion remains confirmed, including local pending backups.
clearDB=async function(){
 const keys=await getModeKeys();
 await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');keys.forEach(key=>tx.objectStore(STORE).delete(key));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
};
updateModeUI();
setTimeout(refreshModeCount,1200);
if('serviceWorker' in navigator && window.isSecureContext && location.protocol!=='file:'){
 navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{
   statusBar.textContent='オフライン起動の準備ができました';
 }).catch(()=>statusBar.textContent='オフライン起動の準備に失敗しました。オンラインで再度開いてください。');
}
setTimeout(syncDrive,1500);

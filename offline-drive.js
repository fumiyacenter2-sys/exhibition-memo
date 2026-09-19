// Local-first recording and authenticated, retryable Drive backup.
const syncSettingsKey = 'exhibition-drive-settings';
let driveSettings = JSON.parse(localStorage.getItem(syncSettingsKey) || '{}');
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
settings.innerHTML = `<p>Googleドライブへの保存</p>
<label>GASのウェブアプリURL<input id="gas-url" type="url" placeholder="https://script.google.com/macros/s/…/exec"></label>
<label>接続キー<input id="gas-token" type="password" autocomplete="off"></label>
<p style="font-size:12px">空欄でも端末に保存して撮影できます。接続後に送信します。</p>
<div class="btn-row"><button class="btn-ok" id="settings-save">保存して同期</button><button class="btn-cancel" id="settings-close">閉じる</button></div>`;
document.body.append(settings);
document.getElementById('drive-settings').onclick = () => {
 document.getElementById('gas-url').value=driveSettings.url || '';
 document.getElementById('gas-token').value=driveSettings.token || '';
 openDialog('drive-dialog');
};
document.getElementById('settings-close').onclick=()=>closeDialog('drive-dialog');
document.getElementById('settings-save').onclick=()=>{
 const url=document.getElementById('gas-url').value.trim(), token=document.getElementById('gas-token').value.trim();
 if(url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { alert('GASの /exec で終わるURLを入力してください');return; }
 driveSettings={url,token};localStorage.setItem(syncSettingsKey,JSON.stringify(driveSettings));
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
saveToDb=function(blob,filename){
 return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   const req=tx.objectStore(STORE).add({blob,filename,downloaded:false,syncId:crypto.randomUUID(),driveId:null});
   tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
};
clipDone=async function(){
 try{
   const mime=chunks[0]?.type || 'video/webm',blob=new Blob(chunks,{type:mime});
   await saveToDb(blob,`記録_${getTimestamp()}_${clipCount+1}_${randStr()}.${getExt(mime)}`);
   clipCount++;countLabel.textContent=`${clipCount} クリップ`;
   savedMsg.textContent='端末に保存しました';savedMsg.style.display='block';
   syncDrive();
 }catch(error){
   // Keep chunks in memory and offer a device download if IndexedDB is full.
   autoDownloadToDevice(new Blob(chunks,{type:chunks[0]?.type || 'video/webm'}),`救出_${getTimestamp()}.${getExt(chunks[0]?.type || '')}`);
   alert('端末内への保存に失敗しました。空き容量を確認してください。動画のダウンロードを試みました。');
 }finally{
   recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;
   recBtn.classList.remove('recording');recBtn.disabled=false;
   document.getElementById('flip-btn').disabled=false;document.getElementById('exit-btn').disabled=false;
   recBadge.style.display='none';countDown.style.display='none';progressEl.style.width='0%';
 }
};
async function driveCall(payload){
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),90000);
 try{
   const response=await fetch(driveSettings.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:driveSettings.token}),signal:controller.signal,redirect:'follow',credentials:'omit'});
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
 if(!driveSettings.url || !driveSettings.token){statusBar.textContent='端末に保存 · ドライブは保存設定から接続';return;}
 syncing=true;
 try{
   const keys=await getAllKeys();let pending=0;
   for(const key of keys){
     const clip=await readClip(key);if(!clip || clip.driveId)continue;
     pending++;
     if(!clip.syncId){clip.syncId=crypto.randomUUID();await putClip(key,{syncId:clip.syncId});}
     statusBar.textContent=`ドライブへ保存中（${pending}本目）…`;
     const data=await driveCall({action:'upload',id:clip.syncId,name:clip.filename,mime:clip.blob.type,base64:await blobBase64(clip.blob)});
     if(!data.id || data.syncId!==clip.syncId)throw Error('保存確認に失敗');
     await putClip(key,{driveId:data.id});
   }
   statusBar.textContent='ドライブへの保存を確認しました';
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
document.querySelector('#clear-dialog p').innerHTML='端末内の全動画を削除しますか？<br>ドライブ未保存の動画も消えます。ドライブ内の動画は削除しません。';
if('serviceWorker' in navigator && window.isSecureContext && location.protocol!=='file:'){
 navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{
   statusBar.textContent='オフライン起動の準備ができました';
 }).catch(()=>statusBar.textContent='オフライン起動の準備に失敗しました。オンラインで再度開いてください。');
}
setTimeout(syncDrive,1500);

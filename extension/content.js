// Only bridge the fixed Progress application origins declared in the manifest.
window.addEventListener('message',event=>{
  const message=event.data;
  if(event.source!==window||event.origin!==location.origin||message?.channel!=='progress-extension-request'||typeof message.requestId!=='string'||!['HELLO','SYNC','READ','OPTIONS'].includes(message.type))return;
  chrome.runtime.sendMessage({type:message.type,sources:message.sources,id:message.id,url:message.url}).then(result=>window.postMessage({channel:'progress-extension-response',requestId:message.requestId,...result},location.origin),()=>window.postMessage({channel:'progress-extension-response',requestId:message.requestId,ok:false,error:'Progress 插件不可用。请刷新页面。'},location.origin));
});

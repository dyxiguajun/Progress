import type {Metric,Workspace} from './model';
import {refreshInterval} from './model';
import {templateUrl} from './validation';
export function extensionRequest<T>(type:string,payload:Record<string,unknown>={},signal?:AbortSignal,timeout=12000):Promise<T>{
  return new Promise((resolve,reject)=>{if(signal?.aborted){reject(signal.reason);return;}
    const requestId=crypto.randomUUID(),timer=setTimeout(()=>finish(new Error('Progress 后台插件未响应。请确认已安装插件并刷新页面。')),timeout);
    function cleanup(){clearTimeout(timer);window.removeEventListener('message',receive);signal?.removeEventListener('abort',abort);}
    function finish(error?:unknown,data?:T){cleanup();if(error)reject(error);else resolve(data!);}
    function abort(){finish(signal?.reason??new DOMException('已取消','AbortError'));}
    function receive(event:MessageEvent){if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='progress-extension-response'||event.data.requestId!==requestId)return;event.data.ok?finish(undefined,event.data.data):finish(new Error(event.data.error??'后台采集失败。'));}
    window.addEventListener('message',receive);signal?.addEventListener('abort',abort,{once:true});window.postMessage({channel:'progress-extension-request',requestId,type,...payload},location.origin);
  });
}
export const extensionAvailable=async()=>{try{await extensionRequest('HELLO',{},undefined,400);return true;}catch{return false;}};
export async function syncBackground(workspace:Workspace){
  if(!await extensionAvailable())return;
  const sources=workspace.instances.flatMap(instance=>{const c=workspace.components.find(c=>c.manifest.id===instance.componentId);return instance.backgroundCollection&&instance.networkConsent&&c?.manifest.runtime.type==='http'?[{id:instance.id,url:templateUrl(c.manifest.runtime.url,instance.config),interval:refreshInterval(c,instance)}]:[];});
  await extensionRequest('SYNC',{sources});
}
export const backgroundMetrics=(id:string,url:string,signal?:AbortSignal)=>extensionRequest<Metric[]>('READ',{id,url},signal);

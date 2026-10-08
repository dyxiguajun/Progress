import {readProgressResponse} from '../src/core/httpResponse';
import type {Metric} from '../src/core/model';
export type Source={id:string;url:string;interval:number};
type Entry=Source & {owner:string;metrics?:Metric[];lastAttempt?:number;lastSuccess?:number;error?:string};
export function sourceUrl(value:string){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||value.length>2048)throw new Error('请填写完整的 HTTP / HTTPS JSON 接口地址。');return url;}
export const permissionOrigin=(url:URL)=>`${url.protocol}//${url.hostname}/*`;
export function approvedOwner(value:string){try{const url=new URL(value);return url.origin==='https://progress-dyxiguajun.pages.dev'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);}catch{return false;}}
export function createCollector(api:any,request:typeof fetch=fetch,clock=Date.now){
  let pending=Promise.resolve();
  const serial=<T,>(run:()=>Promise<T>):Promise<T>=>{const result=pending.then(run,run);pending=result.then(()=>{},()=>{});return result;};
  const entries=async():Promise<Entry[]> => (await api.storage.local.get('sources')).sources??[];
  const allowed=async(url:string)=>{const parsed=sourceUrl(url),{endpoints=[]}=await api.storage.local.get('endpoints');return endpoints.includes(parsed.href)&&await api.permissions.contains({origins:[permissionOrigin(parsed)]});};
  async function schedule(items:Entry[]){if(items.length)await api.alarms.create('progress-poll',{periodInMinutes:.5});else await api.alarms.clear('progress-poll');}
  async function collect(item:Entry){
    const at=clock();if(!await allowed(item.url))return {...item,lastAttempt:at,error:'此域名尚未授权。请在 Progress 插件设置中授权接口域名。'};
    try{const response=await request(item.url,{signal:AbortSignal.timeout(8000),credentials:'omit',cache:'no-store',redirect:'error'});const metrics=await readProgressResponse(response,Math.max(30,item.interval));return {...item,metrics,lastAttempt:at,lastSuccess:clock(),error:undefined};}
    catch(error){return {...item,lastAttempt:at,error:error instanceof Error&&error.name!=='TypeError'&&error.name!=='TimeoutError'?error.message:'进度采集失败。请检查接口地址、JSON 格式及域名权限。'};}
  }
  return {
    sync:(owner:string,sources:Source[])=>serial(async()=>{
      if(!approvedOwner(owner)||!Array.isArray(sources)||sources.length>100)throw new Error('采集请求无效。');
      const old=await entries(),next:Entry[]=old.filter(s=>s.owner!==owner);
      for(const source of sources){if(typeof source.id!=='string'||source.id.length>100||!source.id||!Number.isFinite(source.interval)||source.interval<5||source.interval>86400)throw new Error('采集来源无效。');sourceUrl(source.url);const prior=old.find(s=>s.owner===owner&&s.id===source.id&&s.url===source.url);next.push({...prior,id:source.id,url:source.url,interval:Math.max(30,source.interval),owner});}
      if(next.length>100)throw new Error('最多支持 100 个后台来源。');
      await api.storage.local.set({sources:next});await schedule(next);return {count:sources.length};
    }),
    read:(owner:string,id:string,url:string)=>serial(async()=>{
      if(!approvedOwner(owner))throw new Error('来源页面未授权。');
      const list=await entries(),index=list.findIndex(s=>s.owner===owner&&s.id===id&&s.url===url);if(index<0){sourceUrl(url);const result=await collect({owner,id,url,interval:30});if(result.error)throw new Error(result.error);return result.metrics;}
      let item=list[index];if(!item.lastAttempt||clock()-item.lastAttempt>=item.interval*1000){item=await collect(item);list[index]=item;await api.storage.local.set({sources:list});}
      if(item.error)throw new Error(item.error);if(!item.metrics)throw new Error('等待后台采集数据。');return item.metrics;
    }),
    poll:()=>serial(async()=>{const list=await entries();const updated=await Promise.all(list.map(s=>!s.lastAttempt||clock()-s.lastAttempt>=s.interval*1000?collect(s):s));await api.storage.local.set({sources:updated});await schedule(updated);}),
    clear:()=>serial(async()=>{await api.storage.local.set({sources:[]});await schedule([]);}),
  };
}

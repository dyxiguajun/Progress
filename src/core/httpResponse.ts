import {normalizeMetrics} from './metrics';
import type {Metric} from './model';
export class DataSourceError extends Error {constructor(readonly code:'permission'|'connection'|'invalid',message:string){super(message);}}
export async function readProgressResponse(response:Response,interval:number):Promise<Metric[]> {
  if(!response.ok)throw new DataSourceError('connection',response.status===401||response.status===403?'服务拒绝访问。请检查接口权限或连接凭据。':response.status===404?'没有找到进度接口。请检查完整的 JSON 接口地址。':`服务暂时不可用（${response.status}）。`);
  const contentType=response.headers.get('content-type')??'';
  if(contentType.includes('text/html'))throw new DataSourceError('invalid','这个地址返回了网页，而不是进度数据。请填写返回 JSON 的进度接口地址。');
  const limit=2*1024*1024;if(Number(response.headers.get('content-length')??0)>limit)throw new DataSourceError('invalid','进度数据过大（最多 2 MB）。');
  const reader=response.body?.getReader();if(!reader)throw new DataSourceError('invalid','进度接口没有返回数据。');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new DataSourceError('invalid','进度数据过大（最多 2 MB）。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const text=new TextDecoder().decode(bytes);
  if(/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(text))throw new DataSourceError('invalid','这个地址返回了网页，而不是进度数据。请填写返回 JSON 的进度接口地址。');
  let value:unknown;try{value=JSON.parse(text);}catch{throw new DataSourceError('invalid','接口没有返回有效 JSON。请检查进度接口地址。');}
  let metrics:Metric[];try{metrics=normalizeMetrics(value);}catch{throw new DataSourceError('invalid','JSON 不符合 Progress 进度数据格式。请按 PDM 接口说明提供指标。');}
  const received=new Date().toISOString();return metrics.map(m=>({...m,observed_at:m.observed_at??received,stale_after:m.stale_after??interval*3}));
}

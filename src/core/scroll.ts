export type WheelSample={deltaMode:number;deltaX:number;deltaY:number;ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean;timeStamp?:number};
// A single mapping for all pointing devices; horizontal/modified gestures remain native.
export function createWheelMapper() {return (event:WheelSample,pageWidth:number):number|null=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.deltaX||!event.deltaY)return null;
  return event.deltaY*(event.deltaMode===1?32:event.deltaMode===2?pageWidth:1);
};}

import {approvedOwner,createCollector} from './collector';
declare const chrome:any;
const collector=createCollector(chrome);
chrome.runtime.onInstalled.addListener(()=>void collector.poll());
chrome.runtime.onStartup.addListener(()=>void collector.poll());
chrome.alarms.onAlarm.addListener((alarm:{name:string})=>{if(alarm.name==='progress-poll')void collector.poll();});
chrome.action.onClicked.addListener(()=>void chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message:any,sender:any,reply:(value:any)=>void)=>{
  const own=sender.id===chrome.runtime.id&&!sender.tab;
  const owner=sender.tab?new URL(sender.url).origin:'';
  if(!own&&!approvedOwner(owner))return false;
  let work:Promise<any>;
  switch(message?.type){
    case 'HELLO':work=Promise.resolve({version:'0.6.5'});break;
    case 'SYNC':if(!sender.tab)return false;work=collector.sync(owner,message.sources);break;
    case 'READ':if(!sender.tab)return false;work=collector.read(owner,message.id,message.url);break;
    case 'OPTIONS':work=chrome.runtime.openOptionsPage().then(()=>true);break;
    case 'CLEAR':if(!own)return false;work=collector.clear();break;
    default:return false;
  }
  void work.then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;
});

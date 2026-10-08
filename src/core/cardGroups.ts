import {clone,uid,type CardLayout,type Workspace} from './model';
export type CardGroup={id:string;name:string;cardIds:string[];style:'rings'|'bars';simple?:boolean;layout?:CardLayout};
export function groupIsSimple(group:CardGroup,workspace:Workspace){return group.simple??workspace.groupValues===false;}
export function groupForCard(workspace:Workspace,id:string){return workspace.cardGroups?.find(group=>group.cardIds.includes(id));}
export function visibleGroupCards(workspace:Workspace){const hidden=new Set((workspace.cardGroups??[]).flatMap(group=>group.cardIds.slice(1)));return workspace.cards.filter(card=>!hidden.has(card.id)).map(card=>{const group=groupForCard(workspace,card.id);return group?{...card,title:group.name,layout:group.layout}:card;});}
export function pruneCardGroups(workspace:Workspace):Workspace {
  if(!workspace.cardGroups)return workspace;
  const used=new Set<string>();
  const cardGroups=workspace.cardGroups.flatMap(group=>{const first=workspace.cards.find(c=>c.id===group.cardIds.find(id=>workspace.cards.some(c=>c.id===id)));const ids=group.cardIds.filter(id=>!used.has(id)&&workspace.cards.some(c=>c.id===id&&c.folderId===first?.folderId));if(ids.length<2)return [];ids.forEach(id=>used.add(id));return [{...group,cardIds:ids}];});
  return {...workspace,cardGroups};
}
export function combineCards(workspace:Workspace,source:string,target:string):Workspace {
  const a=workspace.cards.find(c=>c.id===source),b=workspace.cards.find(c=>c.id===target);if(!a||!b||a.id===b.id||a.folderId!==b.folderId)return workspace;
  const from=groupForCard(workspace,source),into=groupForCard(workspace,target);if(from&&from.id===into?.id)return workspace;
  const cardIds=[...new Set([...(into?.cardIds??[target]),...(from?.cardIds??[source])])];if(cardIds.length>32)return workspace;
  const layout=into?.layout??{...clone(b.layout??{variant:'large'}),variant:'large'};
  const group:CardGroup={id:into?.id??uid(),name:into?.name??'组合文件夹',cardIds,style:into?.style??'rings',...(into?.simple!==undefined?{simple:into.simple}:{}),layout};
  return {...workspace,cardGroups:[...(workspace.cardGroups??[]).filter(g=>g.id!==from?.id&&g.id!==into?.id),group]};
}
export function dissolveGroup(workspace:Workspace,id:string):Workspace {return {...workspace,cardGroups:workspace.cardGroups?.filter(g=>g.id!==id)};}
export function moveGroup(workspace:Workspace,id:string,folderId:string):Workspace {
  const group=workspace.cardGroups?.find(g=>g.id===id);if(!group||!workspace.folders?.some(f=>f.id===folderId))return workspace;
  return {...workspace,cards:workspace.cards.map(c=>group.cardIds.includes(c.id)?{...c,folderId,layout:c.layout?{variant:c.layout.variant}:undefined}:c),cardGroups:workspace.cardGroups?.map(g=>g.id===id?{...g,layout:g.layout?{variant:g.layout.variant}:undefined}:g)};
}
export function duplicateGroup(workspace:Workspace,id:string):Workspace {
  const group=workspace.cardGroups?.find(g=>g.id===id);if(!group)return workspace;
  const copies=group.cardIds.map(id=>({...clone(workspace.cards.find(c=>c.id===id)!),id:uid()}));
  return {...workspace,cards:[...workspace.cards,...copies],cardGroups:[...(workspace.cardGroups??[]),{...clone(group),id:uid(),name:`${group.name} · 副本`,cardIds:copies.map(c=>c.id),layout:{variant:group.layout?.variant??'large'}}]};
}

export function groupPresentation(width:number,height:number,count:number,detailed=false,showValues=true) {
  const columns=Math.max(1,Math.floor(width/(detailed?160:140)));
  const compact=width<210&&height<230;
  const cols=compact?Math.min(2,Math.max(1,count)):Math.min(columns,Math.max(1,count));
  const rows=detailed?Math.ceil(count/cols):Math.max(1,Math.floor(height/140));
  const visible=detailed?count:Math.min(count,compact?2:cols*rows);
  const actualRows=Math.max(1,Math.ceil(visible/cols));
  const ringSize=detailed?120:Math.max(40,Math.min(120,(width-(cols-1)*12)/cols-12,(height-(actualRows-1)*12)/actualRows-(showValues?86:54)));
  return {columns:cols,visible,ringSize};
}

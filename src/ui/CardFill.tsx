import { proportion, type Metric, type Card } from '../core/model';
export function CardFill({metric,color,direction='bottom-up',now}:{metric:Metric;color:string;direction?:Card['fillDirection'];now:number}) {
  const ratio=proportion(metric,now);if(ratio===null)return null;
  return <div className={`card-fill fill-${direction}`} style={{'--accent':color,'--fill':`${ratio*100}%`} as React.CSSProperties} role="progressbar" aria-label={`${metric.name} · 整卡进度`} aria-valuenow={ratio*100} aria-valuemin={0} aria-valuemax={100}><div/></div>;
}

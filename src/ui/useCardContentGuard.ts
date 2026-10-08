import {useLayoutEffect,type RefObject} from 'react';
// Legacy cards keep their markup and spacing. Only an actual local overflow causes
// whole secondary fields to disappear; the saved switches are never changed.
export function useCardContentGuard(ref:RefObject<HTMLElement|null>,signature:string,enabled=true){
  useLayoutEffect(()=>{const card=ref.current;if(!card||!enabled)return;
    const update=()=>{
      card.querySelectorAll('[data-adaptive-hidden]').forEach(el=>el.removeAttribute('data-adaptive-hidden'));
      const metric=card.querySelector<HTMLElement>('.metric-view');
      if(metric){const available=metric.clientHeight;metric.querySelectorAll<HTMLElement>('.ring').forEach(ring=>{ring.style.removeProperty('width');ring.style.removeProperty('height');const normal=parseFloat(getComputedStyle(ring).width);if(normal>available-8){ring.style.width=`${Math.max(20,Math.min(normal,available-4))}px`;ring.style.height=ring.style.width;}});}
      card.querySelectorAll<HTMLElement>('.metric-headline,.ring-caption strong,.quota-row strong').forEach(value=>{value.style.removeProperty('font-size');if(value.scrollWidth>value.clientWidth)value.style.fontSize='var(--type-title2)';if(value.scrollWidth>value.clientWidth)value.setAttribute('data-adaptive-hidden','');});
      const exceeds=()=>{
        if(card.scrollHeight>card.clientHeight+1)return true;
        if(!metric)return false;const bounds=metric.getBoundingClientRect();
        return Array.from(metric.querySelectorAll<HTMLElement>('.ring,.ring-caption,.metric-footer,.metric-headline,.secondary')).some(field=>{if(!field.getClientRects().length)return false;const r=field.getBoundingClientRect();return r.height>0&&(r.top<bounds.top-1||r.bottom>bounds.bottom+1);});
      };
      const optional=Array.from(card.querySelectorAll<HTMLElement>('.quota-more,.quota-account,.quota-credits,.secondary,.metric-footer,.ring-caption,.ring-below-value,.quota-footer')).reverse();
      // A numeric footer is atomic; never retain an ellipsis or clipped numerator.
      for(const field of optional){const atomic=field.querySelector<HTMLElement>('.metric-details,.quota-reset-time')??field;if(atomic.scrollWidth>atomic.clientWidth+1)field.setAttribute('data-adaptive-hidden','');}
      for(const field of optional)if(exceeds())field.setAttribute('data-adaptive-hidden','');
      if(exceeds())card.querySelectorAll<HTMLElement>('.card-alert p,.card-recovery').forEach(el=>el.setAttribute('data-adaptive-hidden',''));
      if(exceeds())card.querySelector<HTMLElement>('.metric-label')?.setAttribute('data-adaptive-hidden','');
    };update();const observer=new ResizeObserver(update);observer.observe(card);return()=>observer.disconnect();
  },[ref,signature,enabled]);
}

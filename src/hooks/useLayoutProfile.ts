import {useEffect,useState} from 'react';
import {layoutProfile} from '../core/grid';
export function useLayoutProfile(){
  const read=()=>layoutProfile(innerWidth,innerHeight,matchMedia('(pointer:coarse)').matches);
  const [profile,setProfile]=useState(read);
  useEffect(()=>{const media=matchMedia('(pointer:coarse)'),update=()=>setProfile(read());window.addEventListener('resize',update);media.addEventListener('change',update);return()=>{window.removeEventListener('resize',update);media.removeEventListener('change',update);};},[]);
  return profile;
}

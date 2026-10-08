'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
const AccessContext=createContext<{path:string|null;setPath:(path:string|null)=>void}>({path:null,setPath:()=>{}});
export function SimpleNoveltyAccessProvider({children}:{children:ReactNode}){
  const [path,setPath]=useState<string|null>(null);
  return <AccessContext.Provider value={{path,setPath}}>{children}</AccessContext.Provider>;
}
/** Only server-selected simple list/detail components mount this marker. */
export function SimpleNoveltyAccess(){
  const pathname=usePathname();const {setPath}=useContext(AccessContext);
  useEffect(()=>{setPath(pathname);return()=>setPath(null);},[pathname,setPath]);
  return null;
}
export function useSimpleNoveltyPath(){return useContext(AccessContext).path;}

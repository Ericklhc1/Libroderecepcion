import { COORDINATION_MAX_PAGE, COORDINATION_PAGE_SIZE } from './coordination';

/** Opt-in policies reuse scanPage as a bounded row cursor; saving any version resets it to 1. */
export function substitutionScanCursor(value:number) {
  const maximum=COORDINATION_MAX_PAGE*COORDINATION_PAGE_SIZE;
  const cursor=Number.isSafeInteger(value)&&value>0?(value-1)%maximum:0;
  return {page:Math.floor(cursor/COORDINATION_PAGE_SIZE)+1,offset:cursor%COORDINATION_PAGE_SIZE};
}
export function advanceSubstitutionScan(page:number,index:number,rowCount:number,nextPage:number) {
  if(index+1<rowCount&&index+1<COORDINATION_PAGE_SIZE)return (page-1)*COORDINATION_PAGE_SIZE+index+2;
  const next=nextPage>0&&nextPage<=COORDINATION_MAX_PAGE?nextPage:1;
  return (next-1)*COORDINATION_PAGE_SIZE+1;
}

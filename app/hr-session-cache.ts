'use client';

export const HR_WORKBENCH_CACHE = 'xingjian.hr.workbench.v1';
export const HR_SCREENING_CACHE = 'xingjian.hr.screening.v1';
export const HR_ACCOUNT_CACHE = 'xingjian.hr.account.v1';

const DEFAULT_MAX_AGE = 5 * 60 * 1000;

type CacheEntry<T> = { savedAt:number; data:T };

export function readHrSessionCache<T>(key:string,maxAge=DEFAULT_MAX_AGE):T|null{
  if(typeof window==='undefined')return null;
  try{
    const raw=window.sessionStorage.getItem(key);
    if(!raw)return null;
    const entry=JSON.parse(raw) as CacheEntry<T>;
    if(!entry||typeof entry.savedAt!=='number'||Date.now()-entry.savedAt>maxAge)return null;
    return entry.data;
  }catch{return null}
}

export function writeHrSessionCache<T>(key:string,data:T){
  if(typeof window==='undefined')return;
  try{window.sessionStorage.setItem(key,JSON.stringify({savedAt:Date.now(),data}))}catch{}
}

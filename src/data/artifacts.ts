import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauriRuntime } from "./storage";

export interface InputReceipt {
  id:string; artifactId:string|null; note:string; name:string|null; mime:string|null;
  createdAt:string; source:string; status:"unreviewed"|"drafted"|"discarded";
  width:number|null; height:number|null; trashedAt:string|null; purgedAt:string|null; privacyHash:string|null; bytes:number|null;
}
export interface ReceiptPage {items:InputReceipt[]; unreviewedCount:number; hasMore:boolean}
export interface ArtifactStorage {count:number; originalBytes:number; thumbnailBytes:number; privacyBytes:number; trashBytes:number; databaseBytes:number; databaseOtherBytes:number; warning:boolean}
export const notifyInputs=()=>window.dispatchEvent(new Event("fitwise-inputs-changed"));
export function useInputReceipts(trashed=false,offset=0) {
  const [data,setData]=useState<ReceiptPage>({items:[],unreviewedCount:0,hasMore:false});
  const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!isTauriRuntime())return;
    let active=true;let sequence=0;
    const refresh=()=>{const current=++sequence;setLoading(true);void invoke<ReceiptPage>("list_input_receipts",{trashed,offset}).then(v=>{if(active&&current===sequence){setData(v);setError("");}}).catch(e=>{if(active&&current===sequence)setError(String(e));}).finally(()=>{if(active&&current===sequence)setLoading(false);});};
    refresh();window.addEventListener("fitwise-inputs-changed",refresh);
    return()=>{active=false;window.removeEventListener("fitwise-inputs-changed",refresh);};
  },[trashed,offset]);
  return {data,error,loading};
}
export function useArtifactImage(id:string|null,kind:"thumbnail"|"preview"|"privacy",revision="",enabled=true){
  const [url,setUrl]=useState("");const [error,setError]=useState("");
  useEffect(()=>{
    setUrl("");setError("");if(!id||!enabled||!isTauriRuntime())return;
    let active=true;let objectUrl="";
    void invoke<number[]>("read_artifact_preview",{id,kind}).then(bytes=>{
      if(!active)return;objectUrl=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:kind==="privacy"?"image/png":"image/jpeg"}));setUrl(objectUrl);
    }).catch(e=>{if(active)setError(String(e));});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id,kind,revision,enabled]);
  return {url,error};
}
export const bytesLabel=(n:number)=>n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(2)} MiB`;

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { bytesLabel, notifyInputs, useArtifactImage, type ArtifactStorage, type InputReceipt } from "../data/artifacts";
import { isTauriRuntime } from "../data/storage";
import { redactSensitiveText } from "../domain/privacy";

export function ArtifactThumbnail({item}:{item:InputReceipt}){
  const ref=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!ref.current)return;if(!globalThis.IntersectionObserver){setVisible(true);return;}const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:"150px"});observer.observe(ref.current);return()=>observer.disconnect();},[]);
  const {url}=useArtifactImage(item.artifactId,"thumbnail","",visible&&!item.purgedAt&&!item.trashedAt&&!!item.mime?.startsWith("image/"));
  return <div ref={ref} className="artifact-thumbnail">{url?<img src={url} alt="附件缩略图" loading="lazy"/>:<span>{item.purgedAt?"原件已删除":item.trashedAt?"回收站":item.mime==="application/pdf"?"PDF 原件":item.artifactId?"图片":"文字"}</span>}</div>;
}
export function ImportInputModal({onClose}:{onClose:()=>void}){
  const [paths,setPaths]=useState<string[]>([]);const [note,setNote]=useState("");const [error,setError]=useState("");const action=useConfirmedAction();
  return <Modal title="导入本地素材" onClose={()=>{if(!action.busy)onClose();}}><form className="form" onSubmit={async e=>{e.preventDefault();if(!isTauriRuntime()){setError("附件导入需要桌面版。文字可通过现有手工记录入口保存。");return;}const result=await action.run(JSON.stringify({paths,note}),async requestId=>{try{await invoke("import_local_input",{paths,note,requestId});notifyInputs();return {};}catch(e){return {error:String(e)};}});if(!result.error)onClose();}}>
    <p className="form-hint">只保存在本机收件箱，不读取订单账号、不创建正式饮食或库存，也不发送给 AI。</p>
    <button type="button" className="button secondary" disabled={action.busy} onClick={async()=>{try{const {open}=await import("@tauri-apps/plugin-dialog");const result=await open({multiple:true,directory:false,filters:[{name:"图片或 PDF",extensions:["png","jpg","jpeg","webp","pdf"]}]});if(result)setPaths(Array.isArray(result)?result:[result]);}catch(e){setError(String(e));}}}>选择附件（最多 8 个 / 合计 20 MB）</button>
    {!!paths.length&&<ul className="artifact-files">{paths.map(p=><li key={p}>{p.split(/[\\/]/).at(-1)}</li>)}</ul>}
    <label><span>文字、商品链接或备注</span><textarea maxLength={10000} value={note} disabled={action.busy} onChange={e=>setNote(e.target.value)}/></label>
    <p className="form-hint">支持 PNG/JPEG/WebP（不超过 1600 万像素）；PDF 仅保存原件，不渲染、不识别。HEIC 请先转换。</p>
    {(error||action.message)&&<p role="alert" className="form-error">{error||action.message}</p>}
    <button className="button primary" disabled={action.busy||(!paths.length&&!note.trim())}>{action.busy?"正在保存…":"保存到本地收件箱"}</button>
  </form></Modal>;
}
interface Mask {x:number;y:number;width:number;height:number}
export function ExportArtifactButton({item}:{item:InputReceipt}) {
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  return <div><button type="button" className="button secondary small" disabled={busy||!item.artifactId||!!item.trashedAt||!!item.purgedAt} onClick={async()=>{
    if(busy||!item.artifactId)return;setBusy(true);setMessage("");
    try {
      const extension=item.mime==="image/jpeg"?"jpg":item.mime==="image/webp"?"webp":item.mime==="application/pdf"?"pdf":"png";
      const {save}=await import("@tauri-apps/plugin-dialog");
      const outputPath=await save({title:"原件另存为（未遮挡，不会覆盖已有文件）",defaultPath:`轻衡原件.${extension}`,filters:[{name:"原件",extensions:[extension]}]});
      if(!outputPath)return;
      await invoke("export_artifact_original",{id:item.artifactId,outputPath});
      setMessage("原件已另存。本文件未遮挡、未加密，请妥善保管。");
    }catch(e){setMessage(String(e));}finally{setBusy(false);}
  }}>{busy?"正在导出…":"另存原件（未遮挡）"}</button>{message&&<p role="status" className="form-hint">{message}</p>}</div>;
}
export function ArtifactPrivacyModal({item,onClose}:{item:InputReceipt;onClose:()=>void}){
  const [masks,setMasks]=useState<Mask[]>([]);const [start,setStart]=useState<{x:number;y:number}|null>(null);const [pending,setPending]=useState<Mask|null>(null);const [hash,setHash]=useState(item.privacyHash??"");const [showSaved,setShowSaved]=useState(!!item.privacyHash);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [confirmed,setConfirmed]=useState(false);
  const image=isTauriRuntime()&&!!item.mime?.startsWith("image/")&&!item.purgedAt&&!item.trashedAt;
  const {url,error:imageError}=useArtifactImage(item.artifactId,showSaved?"privacy":"preview",hash,image);
  function point(e:PointerEvent<HTMLDivElement>){const r=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
  function rect(a:{x:number;y:number},b:{x:number;y:number}):Mask{return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};}
  const text=redactSensitiveText(item.note);
  return <Modal title="本地隐私预览与遮挡" onClose={()=>{if(!busy)onClose();}}><div className="privacy-preview artifact-editor"><p className="library-notice">尚未发送云端。遮挡仅生成本地派生图，原件保留；不会自动判断敏感信息是否遮挡完整。</p>
    {item.artifactId&&!item.trashedAt&&!item.purgedAt&&<ExportArtifactButton item={item}/>}
    {image&&<><div className="button-row"><button className="button secondary small" disabled={busy} onClick={()=>{setShowSaved(false);setMasks([]);setConfirmed(false);}}>重新画遮挡区域</button><button className="button secondary small" disabled={busy||showSaved||!masks.length} onClick={()=>setMasks(v=>v.slice(0,-1))}>撤销最后一块</button>{hash&&<button className="button secondary small" disabled={busy} onClick={()=>setShowSaved(true)}>查看已保存遮挡图</button>}</div><p className="form-hint">拖动框选头像、昵称、二维码、地址和订单号。使用不可逆黑块覆盖，不是可恢复的模糊。最多 40 块。</p>
    {url&&<div className={`mask-canvas ${showSaved?"readonly":""}`} onPointerDown={e=>{if(showSaved||busy||masks.length>=40)return;e.currentTarget.setPointerCapture?.(e.pointerId);setStart(point(e));setPending(null);}} onPointerMove={e=>{if(start)setPending(rect(start,point(e)));}} onPointerUp={e=>{if(!start)return;const area=rect(start,point(e));if(area.width>.002&&area.height>.002)setMasks(v=>[...v,area]);setStart(null);setPending(null);setConfirmed(false);}} onPointerCancel={()=>{setStart(null);setPending(null);}}><img src={url} alt={showSaved?"已保存的隐私遮挡图":"本地原件预览，拖动可添加遮挡"} draggable={false}/>{!showSaved&&[...masks,...pending?[pending]:[]].map((m,i)=><span key={i} style={{left:`${m.x*100}%`,top:`${m.y*100}%`,width:`${m.width*100}%`,height:`${m.height*100}%`}}/>)}</div>}
    {!showSaved&&<button className="button primary" disabled={busy||!masks.length||!!start} onClick={async()=>{setBusy(true);setError("");try{const result=await invoke<string>("save_artifact_privacy",{id:item.artifactId,masks});setHash(result);setShowSaved(true);notifyInputs();}catch(e){setError(String(e));}finally{setBusy(false);}}}>{busy?"正在生成…":`保存 ${masks.length} 块遮挡并生成预览`}</button>}</>}
    {!image&&<p className="form-hint">{item.purgedAt?"来源原件已删除，接收记录保留。":item.mime==="application/pdf"?"PDF 原件已保存，本版不渲染、不支持像素遮挡。":"无可预览图片。"}</p>}
    {item.note&&<><h3>文字隐私预览</h3><div className="redacted-preview">{text.redacted}</div></>}
    <label className="checkbox-label"><input type="checkbox" disabled={busy||(image&&(!url||!!imageError))||(!showSaved&&masks.length>0)} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我已检查，标记为本地待识别草稿；不调用 AI、不写入正式记录</span></label>
    {(error||imageError)&&<p className="form-error" role="alert">{error||imageError}</p>}
    <button className="button secondary" disabled={busy||!confirmed||(image&&(!url||!!imageError))||(!showSaved&&masks.length>0)} onClick={async()=>{setBusy(true);try{await invoke("set_input_status",{id:item.id,status:"drafted"});notifyInputs();onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}}>标记本地待识别（AI 尚未接入）</button>
  </div></Modal>;
}
export function ArtifactStoragePanel(){
  const [stats,setStats]=useState<ArtifactStorage|null>(null);const [error,setError]=useState("");
  useEffect(()=>{if(!isTauriRuntime())return;let active=true;const refresh=()=>void invoke<ArtifactStorage>("get_artifact_storage").then(v=>{if(active)setStats(v);}).catch(e=>{if(active)setError(String(e));});refresh();window.addEventListener("fitwise-inputs-changed",refresh);return()=>{active=false;window.removeEventListener("fitwise-inputs-changed",refresh);};},[]);
  return <div className="artifact-storage">{stats?<><div className="storage-breakdown"><span>原件 <b>{bytesLabel(stats.originalBytes)}</b></span><span>缩略图 <b>{bytesLabel(stats.thumbnailBytes)}</b></span><span>遮挡图 <b>{bytesLabel(stats.privacyBytes)}</b></span><span>回收站（含在上项） <b>{bytesLabel(stats.trashBytes)}</b></span><span>数据库其他及空闲页 <b>{bytesLabel(stats.databaseOtherBytes)}</b></span><span>数据库文件合计 <b>{bytesLabel(stats.databaseBytes)}</b></span></div>{stats.warning&&<p role="alert" className="form-error">存储已达到 2 GB，请检查收件箱空间，不会自动删除证据文件。</p>}<p className="form-hint">附件存于 SQLite，分类统计不重复相加。回收站至少保留 30 天，到期后需主动确认清除；清除后空闲页可复用，数据库文件不一定立即变小。备份空间管理暂缓。</p></>:<p>{error||"附件空间统计仅桌面版可用。"}</p>}</div>;
}

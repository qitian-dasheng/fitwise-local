import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, EyeOff, Image, Link2, MessageSquareText, QrCode, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { LabelDraftModal, LabelDraftsPanel } from "../components/LabelDrafts";
import type { LabelDraftRecord } from "../domain/labelDrafts";
import { PageHeader } from "../components/PageHeader";
import { Modal } from "../components/Modal";
import { useAppStore } from "../store/appStore";
import { redactSensitiveText } from "../domain/privacy";
import type { InboxItem } from "../domain/types";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { notifyInputs, useInputReceipts, bytesLabel, type InputReceipt } from "../data/artifacts";
import { ArtifactPrivacyModal, ArtifactThumbnail, ImportInputModal } from "../components/InputArtifacts";

interface UploadSession { url: string; token: string; expiresAt: string }

export function InboxPage() {
  const [labelEditor, setLabelEditor] = useState<{ draft?: LabelDraftRecord; source?: InputReceipt } | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [importOpen,setImportOpen]=useState(false);
  const [trashed,setTrashed]=useState(false);const [offset,setOffset]=useState(0);
  const intake=useInputReceipts(trashed,offset);const [artifactItem,setArtifactItem]=useState<InputReceipt|null>(null);
  const [management,setManagement]=useState<{item:InputReceipt;action:"trash"|"restore"|"purge_expired"}|null>(null);
  const [managing,setManaging]=useState(false);const [starting,setStarting]=useState(false);
  const generation=useRef(0);
  const [privacyItem, setPrivacyItem] = useState<InboxItem | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const action = useConfirmedAction();
  const inbox = useAppStore((state) => state.inbox);
  const setInboxStatus = useAppStore((state) => state.setInboxStatus);
  useEffect(() => () => { generation.current++; if ("__TAURI_INTERNALS__" in window) void invoke("stop_mobile_upload"); }, []);

  async function startSession() {
    const current=++generation.current;setStarting(true);setOpen(true); setError("");
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error("手机上传需要在 Tauri 桌面版中启动；浏览器预览只展示界面。");
      const result = await invoke<UploadSession>("start_mobile_upload");
      if(current!==generation.current){await invoke("stop_mobile_upload");return;}
      setSession(result);
      setQr(await QRCode.toDataURL(result.url, { width: 280, margin: 1, color: { dark: "#17372c", light: "#ffffff" } }));
    } catch (cause) { if(current===generation.current)setError(cause instanceof Error ? cause.message : String(cause)); } finally {setStarting(false);}
  }

  async function closeSession() {
    generation.current++;
    if (session && "__TAURI_INTERNALS__" in window) await invoke("stop_mobile_upload");
    setSession(null); setQr(""); setOpen(false);
  }

  return (
    <div className="page">
      <PageHeader eyebrow="先收集，后确认" title="统一收件箱" description="接收记录与附件同时落盘；只有人工确认的业务记录才进入饮食、运动或库存。" action={<div className="button-row"><button className="button secondary" onClick={() => setLabelEditor({})}>手工整理营养标签</button><button className="button secondary" onClick={()=>setImportOpen(true)}>导入文件 / 文字</button><button className="button primary" disabled={starting} onClick={startSession}><Smartphone size={17}/> 手机上传</button></div>} />
      {(action.message || error || intake.error) && <div className="settings-notice card" role="alert">{action.message || error || intake.error}</div>}
      <div className="inbox-security card"><ShieldCheck size={22}/><div><strong>本地优先 · AI 尚未接入</strong><span>可以保存素材、检查隐私并生成真实像素遮挡图。当前没有云端识别或发送操作。</span></div></div>
      <div className="purchase-filters" role="group" aria-label="收件箱视图"><button className={!trashed?"active":""} onClick={()=>{setTrashed(false);setOffset(0);}}>已接收素材</button><button className={trashed?"active":""} onClick={()=>{setTrashed(true);setOffset(0);}}>原件回收站</button><button onClick={notifyInputs}>刷新</button><button disabled={managing} onClick={async()=>{setManaging(true);try{const r=await invoke<{recovered:number;failed:number}>("recover_legacy_inputs");setError(`旧上传检查完成：${r.recovered} 份已恢复/已存在，${r.failed} 份需手动导入；旧文件未删除。`);notifyInputs();}catch(e){setError(String(e));}finally{setManaging(false);}}}>恢复旧手机上传</button></div>
      <section className="artifact-grid" aria-label="持久化收件箱">{intake.data.items.map(item=><article className="card artifact-card" key={item.id}><ArtifactThumbnail item={item}/><div className="artifact-card-body"><div className="inbox-meta"><span className="status-pill neutral">{item.trashedAt?"回收站":item.status==="drafted"?"已整理草稿":item.status==="discarded"?"已忽略":"待处理"}</span><time>{new Date(item.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</time></div><h3>{item.name??"文字 / 商品链接"}</h3><p>{item.note||"未添加备注"}</p><small>{item.source==="mobile"?"手机上传":"本地导入"}{item.bytes?` · ${bytesLabel(item.bytes)}`:""} {item.purgedAt?"· 来源原件已删除":""}</small><div className="button-row">{!item.trashedAt&&<button className="button secondary small" onClick={() => setLabelEditor({ source: item })}>整理为营养草稿</button>}{!item.trashedAt&&<button className="button secondary small" onClick={()=>setArtifactItem(item)}>查看 / 隐私遮挡</button>}{item.artifactId&&!item.purgedAt&&<button className="text-button" onClick={()=>{setError("");setManagement({item,action:trashed?"restore":"trash"});}}>{trashed?"恢复原件":"原件移入回收站"}</button>}{item.trashedAt&&Date.now()-Date.parse(item.trashedAt)>=30*864e5&&<button className="text-button warning-text" onClick={()=>setManagement({item,action:"purge_expired"})}>清除到期原件</button>}</div></div></article>)}</section>
      {intake.loading&&<p>正在读取接收记录…</p>}{!intake.loading&&!intake.data.items.length&&<div className="card inventory-empty"><strong>{trashed?"回收站为空":"还没有新接收素材"}</strong><p>导入文件或在手机上传后，此处保存的内容重启仍可继续处理。</p></div>}
      <div className="button-row"><button className="button secondary small" disabled={offset===0||intake.loading} onClick={()=>setOffset(v=>Math.max(0,v-50))}>上一页</button><span>第 {offset/50+1} 页 · 每页最多 50 条</span><button className="button secondary small" disabled={!intake.data.hasMore||intake.loading} onClick={()=>setOffset(v=>v+50)}>下一页</button></div>
      {!trashed && <LabelDraftsPanel onOpen={draft => setLabelEditor({ draft })}/>}
      {labelEditor && <LabelDraftModal draft={labelEditor.draft} source={labelEditor.source} onClose={() => setLabelEditor(null)}/>}
      {!trashed&&inbox.length>0&&<h2>旧版草稿（保留原记录）</h2>}
      <section className="inbox-grid">
        {!trashed&&inbox.map((item) => <article className="card inbox-item" key={item.id}>
          <div className={`inbox-kind ${item.kind}`}>{item.kind === "image" ? <Image/> : item.kind === "link" ? <Link2/> : <MessageSquareText/>}</div>
          <div className="inbox-item-main"><div className="inbox-meta"><span className="status-pill neutral">{item.status === "unreviewed" ? "待处理" : item.status}</span><time>{new Date(item.receivedAt).toLocaleString("zh-CN")}</time></div><h3>{item.title}</h3><p>{item.preview}</p></div>
          <div className="inbox-actions"><button className="button secondary small" onClick={() => { setPrivacyItem(item); setPrivacyConfirmed(false); }}>隐私预览</button><button className="icon-button" disabled={action.busy || item.status === "discarded"} title="丢弃" onClick={() => { void action.run(`discard:${item.id}`, (id) => setInboxStatus(item.id, "discarded", id)); }}><Trash2 size={17}/></button></div>
        </article>)}
      </section>
      {open && <Modal title="临时手机上传" onClose={closeSession}><div className="mobile-upload-dialog">{session && qr ? <><img src={qr} alt="手机上传二维码"/><h3>使用同一可信局域网中的手机扫码</h3><p>此会话将在 {new Date(session.expiresAt).toLocaleTimeString("zh-CN")} 失效，关闭窗口会停止服务。HTTP 不提供传输加密，请勿在公共 Wi-Fi 使用。</p><button className="button secondary" onClick={() => navigator.clipboard.writeText(session.url)}><Copy size={16}/> 复制地址</button></> : <div className="upload-error"><QrCode size={54}/><h3>{error || "正在启动本地上传服务…"}</h3>{error && <p>可以关闭此窗口，改用“导入文件 / 文字”。</p>}</div>}</div></Modal>}
      {importOpen&&<ImportInputModal onClose={()=>setImportOpen(false)}/>}
      {artifactItem&&<ArtifactPrivacyModal item={artifactItem} onClose={()=>setArtifactItem(null)}/>}
      {management&&<Modal title={management.action==="restore"?"恢复原件":management.action==="trash"?"原件移入回收站":"永久清除到期原件"} onClose={()=>{if(!managing)setManagement(null);}}><div className="form"><p>{management.action==="restore"?"恢复后可以重新预览和处理。":management.action==="trash"?"同一原件的所有引用都会暂时无法预览。接收记录和已确认业务数据保留，至少 30 天内可恢复；不会自动永久删除。":"原件与派生图将永久清除，无法从回收站恢复；已有加密备份可能仍包含原件。接收记录和正式业务记录不会删除。"}</p><strong>{management.item.name}</strong><button className="button primary" disabled={managing} onClick={async()=>{setManaging(true);try{await invoke("manage_artifact",{id:management.item.artifactId,action:management.action});notifyInputs();setManagement(null);}catch(e){setError(String(e));}finally{setManaging(false);}}}>确认{management.action==="restore"?"恢复":management.action==="trash"?"移入回收站":"永久清除"}</button></div></Modal>}
      {privacyItem && (
        <PrivacyModal
          item={privacyItem}
          confirmed={privacyConfirmed}
          onConfirmed={setPrivacyConfirmed}
          busy={action.busy}
          error={action.message}
          onClose={() => { if (!action.busy) setPrivacyItem(null); }}
          onDraft={async () => {
            const result = await action.run(`draft:${privacyItem.id}`, (id) => setInboxStatus(privacyItem.id, "drafted", id));
            if (!result.error) setPrivacyItem(null);
          }}
        />
      )}
    </div>
  );
}

function PrivacyModal({ item, confirmed, onConfirmed, onClose, onDraft, busy, error }: { item: InboxItem; confirmed: boolean; onConfirmed: (value: boolean) => void; onClose: () => void; onDraft: () => void; busy: boolean; error: string }) {
  const preview = item.kind === "image" ? null : redactSensitiveText(item.preview);
  return <Modal title="本地隐私预览" onClose={onClose}><div className="privacy-preview"><div className="privacy-heading"><EyeOff/><div><h3>尚未上传任何云端服务</h3><p>这一步只在本机检查待处理内容。</p></div></div>{preview ? <><div className="redacted-preview">{preview.redacted}</div><div className="privacy-findings"><b>自动发现</b>{preview.findings.length ? preview.findings.map((finding) => <span key={finding}>{finding}</span>) : <span>未发现常见文本标识，仍需人工检查</span>}</div></> : <div className="image-privacy-warning"><Image/><div><b>图片像素尚未自动遮挡</b><p>请人工确认头像、昵称、二维码、订单号和地址不应外发。当前操作只创建本地草稿；真正调用云端前仍需独立确认。</p></div></div>}<label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)}/><span>我已检查预览，确认仅创建本地草稿，不向 AI 发送</span></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary wide" disabled={!confirmed || busy} onClick={onDraft}><Check size={16}/>{busy ? "正在保存…" : "确认为本地草稿"}</button></div></Modal>;
}

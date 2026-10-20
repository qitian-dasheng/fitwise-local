import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, EyeOff, Image, Link2, MessageSquareText, QrCode, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Modal } from "../components/Modal";
import { useAppStore } from "../store/appStore";
import { redactSensitiveText } from "../domain/privacy";
import type { InboxItem } from "../domain/types";

interface UploadSession { url: string; token: string; expiresAt: string }

export function InboxPage() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [privacyItem, setPrivacyItem] = useState<InboxItem | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const inbox = useAppStore((state) => state.inbox);
  const setInboxStatus = useAppStore((state) => state.setInboxStatus);
  const addInboxItem = useAppStore((state) => state.addInboxItem);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ receivedAt: string; text: string; files: string[] }>("mobile-inbox-changed", (event) => {
      if (disposed) return;
      if (event.payload.text.trim()) addInboxItem({ kind: event.payload.text.startsWith("http") ? "link" : "text", title: "来自手机的文字", preview: event.payload.text });
      for (const file of event.payload.files) addInboxItem({ kind: "image", title: "来自手机的附件", preview: file, artifactPath: file, fingerprint: file.split(".")[0] });
    }).then((dispose) => { unlisten = dispose; });
    return () => { disposed = true; unlisten?.(); };
  }, [addInboxItem]);

  useEffect(() => () => { if (session && "__TAURI_INTERNALS__" in window) void invoke("stop_mobile_upload"); }, [session]);

  async function startSession() {
    setOpen(true); setError("");
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error("手机上传需要在 Tauri 桌面版中启动；浏览器预览只展示界面。");
      const result = await invoke<UploadSession>("start_mobile_upload");
      setSession(result);
      setQr(await QRCode.toDataURL(result.url, { width: 280, margin: 1, color: { dark: "#17372c", light: "#ffffff" } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function closeSession() {
    if (session && "__TAURI_INTERNALS__" in window) await invoke("stop_mobile_upload");
    setSession(null); setQr(""); setOpen(false);
  }

  return (
    <div className="page">
      <PageHeader eyebrow="先收集，后确认" title="统一收件箱" description="手机上传、拖放和 AI 识别都只产生草稿，不会直接污染正式数据。" action={<button className="button primary" onClick={startSession}><Smartphone size={17}/> 手机上传</button>} />
      <div className="inbox-security card"><ShieldCheck size={22}/><div><strong>本地优先</strong><span>附件先保存到电脑；只有你点击识别并确认隐私预览后，才会发送给配置的 AI。</span></div></div>
      <section className="inbox-grid">
        {inbox.map((item) => <article className="card inbox-item" key={item.id}>
          <div className={`inbox-kind ${item.kind}`}>{item.kind === "image" ? <Image/> : item.kind === "link" ? <Link2/> : <MessageSquareText/>}</div>
          <div className="inbox-item-main"><div className="inbox-meta"><span className="status-pill neutral">{item.status === "unreviewed" ? "待处理" : item.status}</span><time>{new Date(item.receivedAt).toLocaleString("zh-CN")}</time></div><h3>{item.title}</h3><p>{item.preview}</p></div>
          <div className="inbox-actions"><button className="button secondary small" onClick={() => { setPrivacyItem(item); setPrivacyConfirmed(false); }}>隐私预览</button><button className="icon-button" title="丢弃" onClick={() => setInboxStatus(item.id, "discarded")}><Trash2 size={17}/></button></div>
        </article>)}
      </section>
      {open && <Modal title="临时手机上传" onClose={closeSession}><div className="mobile-upload-dialog">{session && qr ? <><img src={qr} alt="手机上传二维码"/><h3>使用同一局域网中的手机扫码</h3><p>此会话将在 {new Date(session.expiresAt).toLocaleTimeString("zh-CN")} 失效，关闭窗口会立即停止服务。</p><button className="button secondary" onClick={() => navigator.clipboard.writeText(session.url)}><Copy size={16}/> 复制地址</button></> : <div className="upload-error"><QrCode size={54}/><h3>{error || "正在启动本地上传服务…"}</h3>{error && <p>你仍可先通过文件拖放或剪贴板导入；桌面打包完成后该入口会启用。</p>}</div>}</div></Modal>}
      {privacyItem && (
        <PrivacyModal
          item={privacyItem}
          confirmed={privacyConfirmed}
          onConfirmed={setPrivacyConfirmed}
          onClose={() => setPrivacyItem(null)}
          onDraft={() => {
            setInboxStatus(privacyItem.id, "drafted");
            setPrivacyItem(null);
          }}
        />
      )}
    </div>
  );
}

function PrivacyModal({ item, confirmed, onConfirmed, onClose, onDraft }: { item: InboxItem; confirmed: boolean; onConfirmed: (value: boolean) => void; onClose: () => void; onDraft: () => void }) {
  const preview = item.kind === "image" ? null : redactSensitiveText(item.preview);
  return <Modal title="本地隐私预览" onClose={onClose}><div className="privacy-preview"><div className="privacy-heading"><EyeOff/><div><h3>尚未上传任何云端服务</h3><p>这一步只在本机检查待处理内容。</p></div></div>{preview ? <><div className="redacted-preview">{preview.redacted}</div><div className="privacy-findings"><b>自动发现</b>{preview.findings.length ? preview.findings.map((finding) => <span key={finding}>{finding}</span>) : <span>未发现常见文本标识，仍需人工检查</span>}</div></> : <div className="image-privacy-warning"><Image/><div><b>图片像素尚未自动遮挡</b><p>请人工确认头像、昵称、二维码、订单号和地址不应外发。当前操作只创建本地草稿；真正调用云端前仍需独立确认。</p></div></div>}<label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)}/><span>我已检查预览，确认仅创建本地草稿，不向 AI 发送</span></label><button className="button primary wide" disabled={!confirmed} onClick={onDraft}><Check size={16}/> 确认为本地草稿</button></div></Modal>;
}

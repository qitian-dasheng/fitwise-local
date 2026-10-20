import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Copy, Image, Link2, MessageSquareText, QrCode, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Modal } from "../components/Modal";
import { useAppStore } from "../store/appStore";

interface UploadSession { url: string; token: string; expiresAt: string }

export function InboxPage() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
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
          <div className="inbox-actions"><button className="button secondary small" onClick={() => setInboxStatus(item.id, "drafted")}>生成草稿</button><button className="icon-button" title="丢弃" onClick={() => setInboxStatus(item.id, "discarded")}><Trash2 size={17}/></button></div>
        </article>)}
      </section>
      {open && <Modal title="临时手机上传" onClose={closeSession}><div className="mobile-upload-dialog">{session && qr ? <><img src={qr} alt="手机上传二维码"/><h3>使用同一局域网中的手机扫码</h3><p>此会话将在 {new Date(session.expiresAt).toLocaleTimeString("zh-CN")} 失效，关闭窗口会立即停止服务。</p><button className="button secondary" onClick={() => navigator.clipboard.writeText(session.url)}><Copy size={16}/> 复制地址</button></> : <div className="upload-error"><QrCode size={54}/><h3>{error || "正在启动本地上传服务…"}</h3>{error && <p>你仍可先通过文件拖放或剪贴板导入；桌面打包完成后该入口会启用。</p>}</div>}</div></Modal>}
    </div>
  );
}

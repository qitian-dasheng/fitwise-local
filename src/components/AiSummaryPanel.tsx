import { invoke } from "@tauri-apps/api/core";
import { ClipboardCopy, Download, Sparkles } from "lucide-react";
import { useState } from "react";
import { buildAiSummary } from "../domain/aiSummary";
import { assertDesktopBridge, isTauriRuntime } from "../data/storage";
import { useAppStore } from "../store/appStore";

/**
 * M3：授权摘要导出面板。
 *
 * 「导出内容先经用户确认」由这个面板的结构保证：摘要先进入**可编辑**文本框，
 * 复制 / 保存都是用户对文本框内容的显式动作。默认没有预生成——按钮触发才构建。
 */
export function AiSummaryPanel() {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = () => {
    setText(buildAiSummary(useAppStore.getState()));
    setMessage("摘要已生成。请先核对内容、按需补充忌口与偏好，再复制或保存。");
  };

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMessage("已复制到剪贴板。粘贴给外部 AI 后，把它的 JSON 回贴进下方导入框。");
    } catch (cause) {
      setMessage(`复制失败：${String(cause)}。可在文本框内 Ctrl+A、Ctrl+C 手动复制。`);
    }
  };

  const save = async () => {
    if (!text || busy) return;
    setBusy(true); setMessage("");
    try {
      const name = `qingheng-ai-brief-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
      if (isTauriRuntime()) {
        assertDesktopBridge();
        const { save: pickPath } = await import("@tauri-apps/plugin-dialog");
        const path = await pickPath({ defaultPath: name, filters: [{ name: "轻衡授权摘要", extensions: ["txt", "md"] }] });
        if (!path) { setMessage("已取消，未写入文件。文本仍在上方，可直接复制。"); return; }
        await invoke("write_json_export", { outputPath: path, raw: text });
        setMessage(`已写入并回读校验：${path}`);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("已请求浏览器下载摘要文本。");
      }
    } catch (cause) {
      setMessage(`保存未完成：${String(cause)}。文本仍在上方，可手动复制。`);
    } finally {
      setBusy(false);
    }
  };

  return <section className="card ai-brief-card" aria-label="AI 授权摘要">
    <div className="card-heading compact">
      <div>
        <p className="eyebrow">给外部 AI 的输入</p>
        <h2>授权摘要</h2>
      </div>
      <button className="button secondary small" onClick={generate}><Sparkles size={15} /> 生成摘要</button>
    </div>
    <p className="form-hint">只包含目标、身体、近 7 天摄入与库存剩余这些「读」的信息；不含密钥、审计与任何写入能力。生成后先核对再外发；忌口请直接在文本里补充。</p>
    <textarea
      aria-label="AI 授权摘要内容"
      rows={12}
      value={text}
      placeholder="点「生成摘要」后，这里会出现可编辑的授权摘要全文。"
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
    />
    <div className="button-row">
      <button className="button secondary" disabled={!text} onClick={() => void copy()}><ClipboardCopy size={15} /> 复制摘要</button>
      <button className="button secondary" disabled={!text || busy} onClick={() => void save()}><Download size={15} /> {busy ? "正在保存…" : "保存为文件"}</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}

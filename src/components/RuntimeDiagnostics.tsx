import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauriRuntime } from "../data/storage";

interface Diagnostics {
  appVersion: string; processId: number; executablePath: string; databasePath: string;
  capturedAt: string; snapshotSha256: string | null;
  storage: { initialized: boolean; revision: number | null; entityCount: number; commandCount: number; updatedAt: string | null };
}
export function RuntimeDiagnostics() {
  const [data, setData] = useState<Diagnostics>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError("");
    try { setData(await invoke<Diagnostics>("get_runtime_diagnostics")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (isTauriRuntime()) void refresh(); }, []);
  if (!isTauriRuntime()) return <p className="form-hint">浏览器预览，不是桌面数据库；正式记录请使用轻衡桌面版。</p>;
  // 0.9.4 起挂在设置页弹窗里，卡片壳与标题由 Modal 提供。
  return <div>
    <p>只读查询；不导入、迁移或修改记录。下列信息用于定位当前进程和数据路径，计数相同不等于内容一致。</p>
    <div className="button-row"><button className="button secondary small" disabled={busy} onClick={() => void refresh()}>{busy ? "正在读取…" : "刷新诊断"}</button></div>
    {error && <p role="alert">诊断读取失败：{error}。旧结果不能视为当前保存证明。</p>}
    {data && <dl style={{ overflowWrap: "anywhere" }}>
      <dt>版本 / 进程</dt><dd>{data.appVersion} / PID {data.processId}</dd>
      <dt>安装路径</dt><dd>{data.executablePath}</dd>
      <dt>数据库路径</dt><dd>{data.databasePath}</dd>
      <dt>仓库状态</dt><dd>{data.storage.initialized ? `修订 ${data.storage.revision} · ${data.storage.entityCount} 个实体 · ${data.storage.commandCount} 条命令` : "尚未初始化"}</dd>
      <dt>最后提交</dt><dd>{data.storage.updatedAt ?? "无"}</dd>
      <dt>本次查询时间</dt><dd>{data.capturedAt}</dd>
      <dt>结构化快照 SHA-256（不是数据库文件指纹）</dt><dd>{data.snapshotSha256 ?? "无"}</dd>
    </dl>}
  </div>;
}

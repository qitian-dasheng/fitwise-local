import { useState } from "react";
import { ClipboardPaste, CheckCircle2, Trash2 } from "lucide-react";
import {
  menuDraftFormatExample,
  validateMenuDraftPayload,
  type MenuDraftPayload,
} from "../domain/menuDrafts";
import { notifyMenuDrafts, readMenuDraft, useMenuDrafts, type MenuDraftCheck } from "../data/menuDrafts";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "./useConfirmedAction";

/**
 * M3：AI 菜单草稿导入与确认面板。
 *
 * 通道规则（与 Rust 侧同一套约束的 UI 呈现）：
 * - 导入 = 把外部 AI 输出的 JSON 粘贴进来，走 import_menu_draft 命令，导入时逐条
 *   菜目跑三项校验；结果原样展示，不修饰；
 * - 确认 = 逐条人工点击，Rust 侧再次核对全部通过才把方案写进正式候选表；
 * - 丢弃 = 保留记录、不进菜单；
 * - 空态：没有草稿、全部丢弃、（桌面外）通道不可用，三种都给明确文案，不瞎猜。
 */
export function MenuDraftsPanel() {
  const [pasteText, setPasteText] = useState("");
  const [showFormat, setShowFormat] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [importChecks, setImportChecks] = useState<MenuDraftCheck[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedChecks, setExpandedChecks] = useState<MenuDraftCheck[] | null>(null);
  const list = useMenuDrafts("draft", 0);
  const action = useConfirmedAction();
  const menuDraftCommand = useAppStore((state) => state.menuDraftCommand);

  async function importDraft() {
    let draft: MenuDraftPayload;
    try {
      draft = validateMenuDraftPayload(pasteText);
    } catch (cause) {
      setImportNotice(cause instanceof Error ? cause.message : String(cause));
      setImportChecks(null);
      return;
    }
    setImportNotice("");
    const result = await action.run(`import-menu-draft:${pasteText}`, (id) =>
      menuDraftCommand("import_menu_draft", { draft }, id),
    );
    if (result.error) {
      setImportNotice(result.error);
      setImportChecks(null);
      return;
    }
    const checks = (result as { checks?: MenuDraftCheck[] }).checks ?? null;
    setImportChecks(checks);
    setImportNotice(
      (result as { allChecksPassed?: boolean }).allChecksPassed
        ? "草稿已导入，全部菜目通过三项校验。核对无误后点「确认进菜单」。"
        : "草稿已导入，但有菜目未通过三项校验（见下）；请修正后让 AI 重新输出并再次导入，不能带病确认。",
    );
    notifyMenuDrafts();
  }

  async function confirmDraft(id: string, revision: number) {
    const record = await readMenuDraft(id);
    if (record.checks.some((item) => !item.ok)) {
      setImportNotice("该草稿存在未通过校验的菜目，已阻止确认；请重新导入修正版本。");
      return;
    }
    const result = await action.run(`confirm-menu-draft:${id}`, (commandId) =>
      menuDraftCommand("confirm_menu_draft", { draftId: id, expectedRevision: revision }, commandId),
    );
    if (!result.error) notifyMenuDrafts();
  }

  async function discardDraft(id: string, revision: number) {
    if (!window.confirm("确认丢弃这份草稿？记录会保留，但不会再出现在待确认列表。")) return;
    const result = await action.run(`discard-menu-draft:${id}`, (commandId) =>
      menuDraftCommand("discard_menu_draft", { draftId: id, expectedRevision: revision }, commandId),
    );
    if (!result.error) notifyMenuDrafts();
  }

  async function toggleChecks(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    setExpandedChecks(null);
    try {
      const record = await readMenuDraft(id);
      setExpandedChecks(record.checks);
    } catch (cause) {
      setExpandedChecks([{ name: "", ok: false, error: String(cause) }]);
    }
  }

  return <section className="card menu-drafts-card" aria-label="AI 菜单草稿">
    <div className="card-heading compact">
      <div>
        <p className="eyebrow">外部 AI 只能建草稿</p>
        <h2>AI 菜单草稿</h2>
      </div>
      <button className="text-button" onClick={() => setShowFormat((value) => !value)}>
        {showFormat ? "收起格式说明" : "查看草稿格式"}
      </button>
    </div>
    <p className="form-hint">把授权摘要发给外部 AI，拿回它输出的草稿 JSON 粘贴到下面。导入时逐条菜目跑与标签建档相同的三项校验；确认前不出现在任何统计里。</p>
    {showFormat && <pre className="menu-draft-format">{menuDraftFormatExample}</pre>}
    <label>粘贴外部 AI 输出的草稿 JSON<textarea aria-label="草稿 JSON" rows={8} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder='{"date": "…", "title": "…", "items": […]}' /></label>
    <div className="button-row">
      <button className="button secondary" disabled={action.busy || !pasteText.trim()} onClick={() => void importDraft()}>
        <ClipboardPaste size={15} /> {action.busy ? "正在导入…" : "导入草稿"}
      </button>
    </div>
    {importNotice && <p role={importChecks?.some((item) => !item.ok) ? "alert" : "status"}>{importNotice}</p>}
    {importChecks && (
      <ul className="menu-draft-checks">
        {importChecks.map((item, index) => (
          <li key={index} className={item.ok ? "ok" : "bad"}>
            <b>{item.name || "（未命名）"}</b>
            <span>{item.ok ? item.note ?? "三项校验通过" : item.error}</span>
          </li>
        ))}
      </ul>
    )}

    <div className="menu-drafts-list">
      <h3>待确认草稿 · {list.data.items.length} 份</h3>
      {list.error && <p className="form-error" role="alert">{list.error}</p>}
      {list.loading ? (
        <p className="form-hint">正在读取草稿…</p>
      ) : !list.data.items.length ? (
        <p className="form-hint">暂无待确认草稿。导入的草稿会出现在这里；已确认或已丢弃的不会重复出现。</p>
      ) : (
        list.data.items.map((draft) => (
          <div className="menu-draft-row" key={draft.id}>
            <div>
              <strong>{draft.title?.trim() || "未命名草稿"}</strong>
              <small>
                {draft.date ?? "日期未填"} · 修订 {draft.revision} ·{" "}
                {draft.totalChecks > 0
                  ? draft.failingChecks > 0
                    ? `${draft.failingChecks}/${draft.totalChecks} 项未通过校验`
                    : `${draft.totalChecks} 项校验通过`
                  : "无校验记录"}
              </small>
            </div>
            <div className="button-row">
              <button className="text-button" onClick={() => void toggleChecks(draft.id)}>
                {expanded === draft.id ? "收起校验" : "看校验明细"}
              </button>
              <button
                className="button secondary small"
                disabled={action.busy || draft.failingChecks > 0}
                title={draft.failingChecks > 0 ? "有菜目未通过校验，须重新导入修正版" : "确认后进入候选菜单"}
                onClick={() => void confirmDraft(draft.id, draft.revision)}
              >
                <CheckCircle2 size={14} /> 确认进菜单
              </button>
              <button className="text-button warning-text" disabled={action.busy} onClick={() => void discardDraft(draft.id, draft.revision)}>
                <Trash2 size={14} /> 丢弃
              </button>
            </div>
            {expanded === draft.id && (
              <ul className="menu-draft-checks">
                {(expandedChecks ?? []).map((item, index) => (
                  <li key={index} className={item.ok ? "ok" : "bad"}>
                    <b>{item.name || "（未命名）"}</b>
                    <span>{item.ok ? item.note ?? "三项校验通过" : item.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  </section>;
}

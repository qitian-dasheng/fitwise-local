import { invoke } from "@tauri-apps/api/core";
import { Bot, CircleDollarSign, Send, ShieldCheck, Sparkles, User } from "lucide-react";
import { useEffect, useState } from "react";
import { aiBudgetState, providerDescriptor, validateProviderSettings } from "../ai/providers";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";

export function AssistantPage() {
  const aiSettings = useAppStore((state) => state.aiSettings);
  const descriptor = providerDescriptor(aiSettings.provider);
  const budget = aiBudgetState(aiSettings);
  const providerErrors = validateProviderSettings(aiSettings);
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", text: "我只会基于你确认过的记录给建议。今天想先检查饮食、库存，还是明日菜单？" }]);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<{ configured: boolean }>("get_ai_credential_status", { provider: aiSettings.provider })
      .then((status) => setCredentialConfigured(status.configured))
      .catch(() => setCredentialConfigured(false));
  }, [aiSettings.provider]);

  function send() {
    if (!input.trim()) return;
    const explanation = !credentialConfigured
      ? "当前没有可用凭据。我不会伪造模型回复；饮食、库存、趋势和计划中的本地确定性功能仍可正常使用。"
      : budget.exhausted
        ? "本月 AI 费用软上限已经达到，因此我已切换到手工模式，不会发起云端请求。"
        : providerErrors.length
          ? `AI 配置尚不完整：${providerErrors.join("；")}。`
          : "提供商适配、凭据和费用边界已经就绪，但真实模型请求尚未在此版本开放；你的这条消息没有发送到云端。";
    setMessages((items) => [...items, { role: "user", text: input }, { role: "assistant", text: explanation }]);
    setInput("");
  }

  const ready = credentialConfigured && budget.canCallCloud;
  return <div className="page assistant-page"><PageHeader eyebrow="可选对话 · 不代替确认" title="AI 助手" description="解释和候选由 AI 完成，营养、库存、成本与趋势始终由本地程序计算。"/><div className="assistant-layout"><section className="card chat-panel"><div className="chat-scroll">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><span>{message.role === "assistant" ? <Sparkles size={17}/> : <User size={17}/>}</span><p>{message.text}</p></div>)}</div><form className="chat-input" onSubmit={(event) => { event.preventDefault(); send(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：为什么明天优先推荐豆腐和里脊？"/><button className="icon-button solid" type="submit"><Send size={18}/></button></form></section><aside className="stack"><article className="card assistant-status"><Bot/><div><p className="eyebrow">提供商状态</p><h3>{ready ? `${descriptor.label} 边界就绪` : "手工模式"}</h3><p>{credentialConfigured ? `模型：${aiSettings.model || "尚未填写"}。真实对话请求仍保持关闭。` : "在设置页配置前，不会发起任何云端请求。"}</p></div></article><article className="card assistant-status"><CircleDollarSign/><div><p className="eyebrow">本月估算费用</p><h3>¥{aiSettings.estimatedSpendCny.toFixed(2)}{aiSettings.monthlyLimitCny === undefined ? " / 不限额" : ` / ¥${aiSettings.monthlyLimitCny.toFixed(2)}`}</h3><p>达到软上限后自动回退手工模式，不影响当天记录。</p></div></article><article className="card assistant-status"><ShieldCheck/><div><p className="eyebrow">数据边界</p><h3>无自动外发</h3><p>收件箱先进行本地隐私预览；图片未实际遮挡时会明确提示人工复核。</p></div></article></aside></div></div>;
}

import { Bot, Send, ShieldCheck, Sparkles, User } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";

export function AssistantPage() {
  const [messages, setMessages] = useState([{ role: "assistant", text: "我只会基于你确认过的记录给建议。今天想先检查饮食、库存，还是明日菜单？" }]);
  const [input, setInput] = useState("");
  function send() { if (!input.trim()) return; setMessages((items) => [...items, { role: "user", text: input }, { role: "assistant", text: "这是一个本地结构化助手界面。AI 提供商尚未配置，因此我不会编造分析；你仍可以使用饮食、库存和计划页面中的确定性功能。" }]); setInput(""); }
  return <div className="page assistant-page"><PageHeader eyebrow="可选对话 · 不代替确认" title="AI 助手" description="解释和候选由 AI 完成，营养、库存、成本与趋势始终由本地程序计算。"/><div className="assistant-layout"><section className="card chat-panel"><div className="chat-scroll">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><span>{message.role === "assistant" ? <Sparkles size={17}/> : <User size={17}/>}</span><p>{message.text}</p></div>)}</div><form className="chat-input" onSubmit={(event) => { event.preventDefault(); send(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：为什么明天优先推荐豆腐和里脊？"/><button className="icon-button solid" type="submit"><Send size={18}/></button></form></section><aside className="stack"><article className="card assistant-status"><Bot/><div><p className="eyebrow">提供商状态</p><h3>尚未配置</h3><p>未配置时应用仍可完整手工记录，不会阻断当天完成。</p></div></article><article className="card assistant-status"><ShieldCheck/><div><p className="eyebrow">数据边界</p><h3>无自动外发</h3><p>图片会先遮挡头像、订单号和地址，并在上传前显示预览。</p></div></article></aside></div></div>;
}

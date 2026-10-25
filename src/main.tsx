import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// 顺序即优先级：令牌与字体在前，组件样式 styles.css（0.9.4 起全量 --ui-* 令牌化，theme.css 桥接层已退役），ui.css 是方向 D 组件层，base 最后接手全局字体与焦点环。
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles.css";
import "./styles/ui.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

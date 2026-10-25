import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// 顺序即优先级：令牌与字体在前，旧 styles.css 在中，theme 重映射在其后覆盖旧变量，ui.css 是方向 D 组件层（0.9.3 迁移），base 最后接手全局字体与焦点环。
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles.css";
import "./styles/theme.css";
import "./styles/ui.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

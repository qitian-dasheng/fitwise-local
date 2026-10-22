import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// 顺序即优先级：令牌与字体在前，旧 styles.css 仍可覆盖自己的变量；base 最后接手全局字体与焦点环。
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

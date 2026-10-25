import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./styles/tokens.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* reducedMotion="user": Motion honours prefers-reduced-motion for every transform animation */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);

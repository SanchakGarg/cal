import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { App } from "./App.tsx";
import { AuthProvider } from "./app/auth.tsx";
import { RouterProvider } from "./app/router.tsx";
import { ToastProvider } from "./ui/Toast.tsx";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    {/* `domAnimation` is the small feature set the `m` components need; loading
        it here keeps the animation code out of every page bundle. `reducedMotion`
        set to "user" means the OS setting turns transforms into plain fades
        without any page having to check for itself. */}
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <RouterProvider>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </RouterProvider>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>
);

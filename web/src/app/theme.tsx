import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "cal.theme";

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) ?? "system");

  useEffect(() => {
    localStorage.setItem(KEY, theme);
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = (): void => {
        root.setAttribute("data-theme", media.matches ? "dark" : "light");
      };
      apply();
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    root.setAttribute("data-theme", theme);
    return undefined;
  }, [theme]);

  return { theme, setTheme };
}

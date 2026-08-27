import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "cal.theme";

/** Dark unless the user has said otherwise. The same default is inlined in
 *  index.html so the first paint already matches. */
const DEFAULT_THEME: Theme = "dark";

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // Private browsing can make localStorage throw; fall back to the default.
  }
  return DEFAULT_THEME;
}

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Not persisting the choice is better than breaking the page.
    }
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

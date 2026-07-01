import { useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "mm-theme";

function readCurrentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readCurrentTheme);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }

  return { theme, toggle };
}

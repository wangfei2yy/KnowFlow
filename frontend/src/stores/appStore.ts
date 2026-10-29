import { defineStore } from "pinia";

export type ToastType = "info" | "success" | "error";
export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "knowflow.theme";

function loadTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

/** 把主题落到 <html class="dark"> 上 */
export function applyTheme(mode: ThemeMode): void {
  const prefersDark =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && !!prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export const useAppStore = defineStore("app", {
  state: () => ({
    sidebarOpen: false,
    toast: { visible: false, message: "", type: "info" as ToastType },
    theme: loadTheme() as ThemeMode
  }),
  getters: {
    /** 当前是否为深色（含系统跟随） */
    isDark(state): boolean {
      if (state.theme === "dark") return true;
      if (state.theme === "light") return false;
      return (
        typeof window !== "undefined" &&
        !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
      );
    }
  },
  actions: {
    showToast(message: string, type: ToastType = "info") {
      this.toast = { visible: true, message, type };
    },
    hideToast() {
      this.toast.visible = false;
    },
    /** 切换主题：light / dark / system，持久化并立即生效 */
    setTheme(mode: ThemeMode) {
      this.theme = mode;
      try {
        localStorage.setItem(THEME_KEY, mode);
      } catch {
        /* ignore */
      }
      applyTheme(mode);
    },
    /** 在「浅色 → 深色」间快速切换（侧边栏按钮用） */
    toggleDark() {
      this.setTheme(this.isDark ? "light" : "dark");
    },
    /** 首屏应用已保存的主题，并监听系统主题变化（仅 system 模式生效） */
    initTheme() {
      applyTheme(this.theme);
      if (typeof window === "undefined" || !window.matchMedia) return;
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (this.theme === "system") applyTheme("system");
      };
      mq.addEventListener?.("change", onChange);
    }
  }
});

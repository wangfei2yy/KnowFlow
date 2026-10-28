import { defineStore } from "pinia";

export type ToastType = "info" | "success" | "error";

export const useAppStore = defineStore("app", {
  state: () => ({
    sidebarOpen: false,
    toast: { visible: false, message: "", type: "info" as ToastType }
  }),
  actions: {
    showToast(message: string, type: ToastType = "info") {
      this.toast = { visible: true, message, type };
    },
    hideToast() {
      this.toast.visible = false;
    }
  }
});

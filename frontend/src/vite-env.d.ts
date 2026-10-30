/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/** 构建时注入的版本号（vite.config.ts 的 define），用于「页面是不是旧版本」自检 */
declare const __BUILD_ID__: string;

/**
 * 运行环境标记。
 *
 * `__KF_MINITOOL__` 由 Vite define 在构建期替换为字面量 true / false，
 * 因此 `if (IS_MINITOOL)` 这类分支在打包时会被完全消除，
 * 小工具产物里不会残留网络请求、Web Worker 等被容器禁止的代码。
 */
declare const __KF_MINITOOL__: boolean;

export const IS_MINITOOL = __KF_MINITOOL__;

/** 小工具容器（小红书端内）是否已就绪 */
export function hasMiniToolBridge(): boolean {
  const w = window as unknown as { xhs?: { miniTool?: unknown } };
  return !!(w.xhs && w.xhs.miniTool);
}

/** 第三方/端内浏览器识别：这些环境普遍没有可用的网页语音识别 */
const IN_APP_BROWSERS: { test: RegExp; name: string; tip: string }[] = [
  {
    test: /MicroMessenger/i,
    name: "微信",
    tip: "点右上角「…」选择「在浏览器打开」，或用手机自带浏览器打开本页"
  },
  {
    test: /(baidubrowser|bdbrowser|baiduboxapp|BIDUBrowser)/i,
    name: "百度浏览器",
    tip: "用手机自带浏览器（或 Chrome / Safari）打开本页，语音识别即可用"
  },
  {
    test: /MQQBrowser/i,
    name: "QQ 浏览器",
    tip: "用手机自带浏览器（或 Chrome / Safari）打开本页，语音识别即可用"
  },
  {
    test: /(UCBrowser|UBrowser)/i,
    name: "UC 浏览器",
    tip: "用手机自带浏览器（或 Chrome / Safari）打开本页，语音识别即可用"
  },
  {
    test: /Quark/i,
    name: "夸克",
    tip: "用手机自带浏览器（或 Chrome / Safari）打开本页，语音识别即可用"
  },
  {
    test: /(XiaoHongShu|xiaohongshu)/i,
    name: "小红书",
    tip: "点右上角「…」选择「在浏览器打开」，或用手机自带浏览器打开本页"
  },
  {
    test: /Weibo/i,
    name: "微博",
    tip: "点右上角「…」选择「在浏览器打开」，或用手机自带浏览器打开本页"
  },
  {
    test: /AlipayClient/i,
    name: "支付宝",
    tip: "用手机自带浏览器（或 Chrome / Safari）打开本页，语音识别即可用"
  }
];

/** 识别当前所在的第三方/端内浏览器（识别不到返回 null） */
export function detectInAppBrowser(): { name: string; tip: string } | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  for (const item of IN_APP_BROWSERS) {
    if (item.test.test(ua)) return { name: item.name, tip: item.tip };
  }
  return null;
}

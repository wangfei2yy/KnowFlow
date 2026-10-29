import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteLocation } from "vue-router";
import { IS_MINITOOL } from "@/utils/runtime";

const routes = [
  { path: "/", name: "home", component: () => import("@/pages/HomePage.vue"), meta: { title: "首页" } },
  { path: "/library", name: "library", component: () => import("@/pages/LibraryPage.vue"), meta: { title: "资料库" } },
  { path: "/library/:id", name: "detail", component: () => import("@/pages/DocumentDetailPage.vue"), meta: { title: "资料详情" } },
  { path: "/editor", name: "editor", component: () => import("@/pages/EditorPage.vue"), meta: { title: "新增资料" } },
  { path: "/editor/:id", name: "editor-edit", component: () => import("@/pages/EditorPage.vue"), meta: { title: "编辑资料" } },
  { path: "/assistant", name: "assistant", component: () => import("@/pages/AssistantPage.vue"), meta: { title: "AI 工作台" } },
  { path: "/tasks", name: "tasks", component: () => import("@/pages/TasksPage.vue"), meta: { title: "任务清单" } },
  // 学习模块：一个外壳 + 四个子面板，切换 Tab 不整页跳转
  {
    path: "/study",
    component: () => import("@/pages/StudyLayout.vue"),
    children: [
      {
        path: "",
        name: "study",
        component: () => import("@/pages/StudyOverview.vue"),
        meta: { title: "学习" }
      },
      {
        path: "cards",
        name: "study-cards",
        component: () => import("@/pages/StudyPage.vue"),
        meta: { title: "卡片复习" }
      },
      // 语法与闯关依赖在线知识包（fetch），端内不注册子路由，也就不会打进产物
      ...(IS_MINITOOL
        ? []
        : [
            {
              path: "grammar",
              name: "study-grammar",
              component: () => import("@/pages/GrammarPage.vue"),
              meta: { title: "语法学习" }
            },
            {
              path: "idiom",
              name: "study-idiom",
              component: () => import("@/pages/IdiomPage.vue"),
              meta: { title: "成语学习" }
            },
            // 趣味学习 → 具体玩法。球球是全屏 Canvas，单独一个页面，不塞进列表页
            {
              path: "words",
              name: "study-words",
              component: () => import("@/pages/WordPage.vue"),
              meta: { title: "单词学习" }
            },
            {
              path: "play",
              name: "study-play",
              component: () => import("@/pages/PlayHomePage.vue"),
              meta: { title: "趣味学习" }
            },
            {
              path: "play/quest",
              name: "study-play-quest",
              component: () => import("@/pages/QuestPage.vue"),
              meta: { title: "单词闯关" }
            },
            {
              path: "play/orb",
              name: "study-play-orb",
              component: () => import("@/pages/OrbPage.vue"),
              meta: { title: "单词球球" }
            },
            {
              path: "play/idiom",
              name: "study-play-idiom",
              component: () => import("@/pages/IdiomGamePage.vue"),
              meta: { title: "成语填空" }
            },
            {
              path: "play/pair",
              name: "study-play-pair",
              component: () => import("@/pages/PairPage.vue"),
              meta: { title: "中英配对" }
            },
            {
              path: "play/runner",
              name: "study-play-runner",
              component: () => import("@/pages/RunnerPage.vue"),
              meta: { title: "单词跑酷" }
            }
          ])
    ]
  },
  // 饮食模块：食谱 / 时令 / 计划，依赖在线知识包
  ...(IS_MINITOOL
    ? []
    : [
        {
          path: "/kitchen",
          component: () => import("@/pages/KitchenLayout.vue"),
          children: [
            {
              path: "",
              name: "kitchen",
              component: () => import("@/pages/RecipePage.vue"),
              meta: { title: "食谱" }
            },
            {
              path: "season",
              name: "kitchen-season",
              component: () => import("@/pages/SeasonPage.vue"),
              meta: { title: "时令" }
            },
            {
              path: "plan",
              name: "kitchen-plan",
              component: () => import("@/pages/PlanPage.vue"),
              meta: { title: "饮食计划" }
            },
            {
              path: "ingredient",
              name: "kitchen-ingredient",
              component: () => import("@/pages/IngredientPage.vue"),
              meta: { title: "食材图鉴" }
            }
          ]
        }
      ]),
  { path: "/import", name: "import", component: () => import("@/pages/ImportPage.vue"), meta: { title: "文件导入" } },
  { path: "/settings", name: "settings", component: () => import("@/pages/SettingsPage.vue"), meta: { title: "设置" } }
];

/**
 * 旧链接兼容：这几个路径在上一版是顶层页面 / 顶层子路由，已发布出去，不能直接失效。
 * 用 redirect 保留 query（例如 /grammar?topic=xxx、/study/play/quest?pack=cet6）。
 */
const legacyRoutes = IS_MINITOOL
  ? []
  : [
      {
        path: "/grammar",
        redirect: (to: RouteLocation) => ({
          path: "/study/grammar",
          query: to.query
        })
      },
      { path: "/quest", redirect: "/study/play/quest" },
      { path: "/study/quest", redirect: "/study/play/quest" }
    ];

/**
 * 兜底：未匹配的路径回首页。
 * 典型场景是端内打开了网页版分享的 /study/grammar（端内没注册该子路由），
 * 不加兜底会停在空白页。
 */
const fallbackRoute = { path: "/:pathMatch(.*)*", redirect: "/" };

export const router = createRouter({
  // 使用 hash 路由，静态托管刷新不 404，便于发布到任意子路径
  history: createWebHashHistory(),
  routes: [...routes, ...legacyRoutes, fallbackRoute]
});

/**
 * 旧链接兼容：/study?mode=review 与 /study?card=xxx 是上一版卡片复习的地址。
 * 放在路由守卫里而不是组件内——只有 query 变化时组件不会重新挂载，onMounted 抓不到。
 */
router.beforeEach((to) => {
  if (to.path === "/study" && (to.query.mode || to.query.card)) {
    return { path: "/study/cards", query: to.query };
  }
  return true;
});

/**
 * 弱网下懒加载 chunk 失败时，旧代码会停在空白页。
 * 这里自动重载一次（用 sessionStorage 防死循环），仍失败则提示。
 */
router.onError((error) => {
  const message = String(error?.message ?? error);
  const isChunkError = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
  if (!isChunkError) return;
  const KEY = "knowflow.chunkRetry";
  if (sessionStorage.getItem(KEY)) {
    sessionStorage.removeItem(KEY);
    console.error("[KnowFlow] 页面资源加载失败：", message);
    return;
  }
  sessionStorage.setItem(KEY, "1");
  location.reload();
});

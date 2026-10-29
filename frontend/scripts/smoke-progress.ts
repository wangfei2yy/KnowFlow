/**
 * 进度存档单测：闯关会话、复习位置、游戏成绩三块 localStorage 逻辑。
 * 跑法：npm run test:progress
 */
import {
  loadQuestSessions,
  loadQuestSession,
  saveQuestSession,
  clearQuestSession,
  resumeSession,
  loadStudyPosition,
  saveStudyPosition,
  clearStudyPosition,
  fingerprintOf,
  loadGameProgress,
  saveGameResult,
  gameScoreOf,
  loadPlayPack,
  savePlayPack,
  type SavedQuest
} from "@/services/gameService";
import { startSession, answerCurrent, type WordEntry } from "@/services/quest/engine";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const words: WordEntry[] = Array.from({ length: 12 }, (_, i) => ({
  w: `w${i}`,
  m: `义${i}`
}));

function newSession(size = 5) {
  return startSession(words, { size, lives: 3, rng: () => 0.42 });
}

// ---------------- 1) 写入与读取 ----------------
const s5 = newSession();
ok(s5.questions.length === 5, "应生成 5 题");
saveQuestSession("cet4", s5);
ok(!!loadQuestSession("cet4"), "cet4 应能读回存档");
ok(loadQuestSession("cet6") === null, "cet6 没有存档");
ok(Object.keys(loadQuestSessions()).length === 1, "应只有一条存档");

// 按词库分开存：切词库不冲掉另一份
saveQuestSession("cet6", newSession());
ok(Object.keys(loadQuestSessions()).length === 2, "两个词库各存一条");
ok(!!loadQuestSession("cet4") && !!loadQuestSession("cet6"), "两份都在");

// 清一个不影响另一个
clearQuestSession("cet6");
ok(loadQuestSession("cet6") === null, "cet6 已清除");
ok(!!loadQuestSession("cet4"), "cet4 应保留");
console.log("1) 按词库存档：OK");

// ---------------- 2) 进度内容完整 ----------------
const mid = newSession(5);
const answered: typeof mid = { ...mid, index: 2, lives: 2, score: 30, streak: 2, bestStreak: 2 };
saveQuestSession("cet4", answered);
const back = loadQuestSession("cet4")!;
ok(back.session.index === 2, "题号应保留");
ok(back.session.lives === 2, "生命应保留");
ok(back.session.score === 30, "分数应保留");
ok(back.session.questions.length === 5, "题目应整份保留（重抽会变题）");
console.log("2) 读回第", back.session.index + 1, "题，生命", back.session.lives, "分", back.session.score);

// ---------------- 3) 已结束 / 空题目 视为无存档 ----------------
const done = newSession(5);
saveQuestSession("cet4", { ...done, finished: true });
ok(loadQuestSession("cet4") === null, "已结束的局不该恢复");

const empty = newSession(5);
saveQuestSession("cet4", { ...empty, questions: [] });
ok(loadQuestSession("cet4") === null, "空题目不该恢复");

// ---------------- 4) 过期（>7 天） ----------------
clearQuestSession();
const old = newSession(5);
const oldSaved: SavedQuest = {
  packId: "cet4",
  session: old,
  savedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
};
localStorage.setItem("knowflow.quest.session", JSON.stringify({ cet4: oldSaved }));
ok(loadQuestSession("cet4") === null, "超过 7 天应视为过期");
ok(Object.keys(loadQuestSessions()).length === 0, "过期数据应被清理");

// 6 天内仍可用
const fresh: SavedQuest = {
  packId: "cet4",
  session: old,
  savedAt: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString()
};
localStorage.setItem("knowflow.quest.session", JSON.stringify({ cet4: fresh }));
ok(!!loadQuestSession("cet4"), "6 天内应可用");
console.log("4) 7 天过期判定：OK");

// ---------------- 5) answered 状态的恢复 ----------------
const live = newSession(3);
const q = live.questions[0];
const afterAnswer = answerCurrent(live, q.answer);
ok(afterAnswer.answered === true, "应标记已作答");

const resumed = resumeSession({ packId: "cet4", session: afterAnswer, savedAt: new Date().toISOString() });
ok(!!resumed, "中途退出应能恢复");
ok(resumed!.session.index === 1, "已作答的那题应自动推进到第 2 题");
ok(resumed!.session.answered === false, "恢复后应可继续作答");

// 最后一题作答后退出 → 这局本来就结束了，不再恢复
const lastIdx = 2;
const atLast = { ...afterAnswer, index: lastIdx };
ok(resumeSession({ packId: "cet4", session: atLast, savedAt: new Date().toISOString() }) === null, "最后一题答完不该再恢复");
console.log("5) answered 恢复：自动跳到第", resumed!.session.index + 1, "题");

// ---------------- 6) 队列指纹 ----------------
const fp1 = fingerprintOf(["a", "b", "c"]);
ok(fp1 === fingerprintOf(["a", "b", "c"]), "同一批卡片指纹应稳定");
ok(fp1 !== fingerprintOf(["a", "b", "d"]), "内容变了指纹应变");
ok(fingerprintOf(["ab", "c"]) !== fingerprintOf(["a", "bc"]), "拼接要有分隔，避免串位撞车");
ok(fingerprintOf([]) === fingerprintOf([]), "空队列也稳定");
console.log("6) 指纹：", fp1);

// ---------------- 7) 复习位置 ----------------
ok(loadStudyPosition() === null, "初始没有位置");
saveStudyPosition(fp1, 4);
const pos = loadStudyPosition()!;
ok(pos.index === 4 && pos.fingerprint === fp1, "位置应存下来");
clearStudyPosition();
ok(loadStudyPosition() === null, "位置应能清除");

// ---------------- 8) 游戏成绩 ----------------
ok(Object.keys(loadGameProgress()).length === 0, "初始无成绩");
saveGameResult("orb", "cet4", 120);
let prog = saveGameResult("orb", "cet4", 90);
ok(gameScoreOf(prog, "orb", "cet4").bestScore === 120, "最高分应保留较大值");
ok(gameScoreOf(prog, "orb", "cet4").plays === 2, "局数应累加");
prog = saveGameResult("orb", "cet6", 300);
ok(gameScoreOf(prog, "orb", "cet6").bestScore === 300, "不同词库分开记");
ok(gameScoreOf(prog, "orb", "cet4").bestScore === 120, "cet4 不受影响");
ok(gameScoreOf(prog, "quest", "cet4").plays === 0, "不同游戏分开记");
prog = saveGameResult("orb", "cet4", 200);
ok(gameScoreOf(prog, "orb", "cet4").bestScore === 200, "更高分应刷新");
console.log("8) 成绩：", JSON.stringify(prog.orb));

// ---------------- 9) 游戏中心选中的词库 ----------------
ok(loadPlayPack() === "cet4", "默认 cet4");
savePlayPack("cet6");
ok(loadPlayPack() === "cet6", "记住上次选的词库");

// ---------------- 10) 坏数据不炸 ----------------
localStorage.setItem("knowflow.quest.session", "{ 这不是 json");
ok(loadQuestSessions() !== null, "坏 JSON 应返回空表而不是抛错");
ok(Object.keys(loadQuestSessions()).length === 0, "坏 JSON 解析为空");
localStorage.setItem("knowflow.study.position", "null");
ok(loadStudyPosition() === null, "坏位置数据返回 null");
localStorage.setItem("knowflow.game.progress", '"x"');
ok(typeof loadGameProgress() === "object", "坏成绩数据不抛错");

console.log("\n✅ 进度存档 10 组断言全部通过");

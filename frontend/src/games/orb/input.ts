/**
 * 单词球球 · 输入。
 *
 * 统一用 Pointer Events：鼠标、触屏、触控笔一套代码，不再分 mouse/touch 两套。
 * 三种操作映射到同一个方向向量：
 * - 键盘：WASD / 方向键，按满速
 * - 鼠标：光标相对屏幕中心的方向，离得越远越快
 * - 触屏：手指按下处为原点的「相对拖动」摇杆，死区 8px、行程 48px
 *
 * 摇杆一定是相对拖动：绝对定位（手指必须点在摇杆上）在手机上会漏掉一半的手势。
 */

export interface JoystickState {
  active: boolean;
  /** 摇杆圆心（相对画布左上角） */
  x: number;
  y: number;
  /** 摇杆头相对圆心的偏移 */
  dx: number;
  dy: number;
}

export interface OrbInput {
  dir(): { x: number; y: number };
  dispose(): void;
}

const DEAD_ZONE = 8;
const KNOB_RANGE = 48;

export function createOrbInput(
  el: HTMLElement,
  onJoystick?: (state: JoystickState) => void
): OrbInput {
  const keys = new Set<string>();
  const mouse = { x: 0, y: 0, inside: false, pressed: false };
  const touch = { active: false, id: -1, x: 0, y: 0, dx: 0, dy: 0 };

  function emit() {
    onJoystick?.({ active: touch.active, x: touch.x, y: touch.y, dx: touch.dx, dy: touch.dy });
  }

  function localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
      keys.add(k);
      // 方向键在页面里会滚动，游戏进行中要拦下来
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key.toLowerCase());
  }

  function onBlur() {
    keys.clear();
    touch.active = false;
    mouse.pressed = false;
    emit();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse") {
      mouse.pressed = true;
      const p = localPoint(e);
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.inside = true;
      return;
    }
    // 只认第一根手指，第二根按下不打断
    if (touch.active) return;
    touch.active = true;
    touch.id = e.pointerId;
    const p = localPoint(e);
    touch.x = p.x;
    touch.y = p.y;
    touch.dx = 0;
    touch.dy = 0;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 某些浏览器不支持捕获，忽略 */
    }
    emit();
  }

  function onPointerMove(e: PointerEvent) {
    const p = localPoint(e);
    if (e.pointerType === "mouse") {
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.inside = true;
      return;
    }
    if (!touch.active || e.pointerId !== touch.id) return;
    let dx = p.x - touch.x;
    let dy = p.y - touch.y;
    const len = Math.hypot(dx, dy);
    if (len > KNOB_RANGE) {
      dx = (dx / len) * KNOB_RANGE;
      dy = (dy / len) * KNOB_RANGE;
    }
    touch.dx = dx;
    touch.dy = dy;
    emit();
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType === "mouse") {
      mouse.pressed = false;
      // 指针离开画布后不该继续被当成方向输入
      if (e.type === "pointerleave") mouse.inside = false;
      return;
    }
    if (e.pointerId !== touch.id) return;
    touch.active = false;
    touch.id = -1;
    touch.dx = 0;
    touch.dy = 0;
    emit();
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointerleave", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  function dir(): { x: number; y: number } {
    // 1) 键盘优先
    let kx = 0;
    let ky = 0;
    if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
    if (keys.has("d") || keys.has("arrowright")) kx += 1;
    if (keys.has("w") || keys.has("arrowup")) ky -= 1;
    if (keys.has("s") || keys.has("arrowdown")) ky += 1;
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      return { x: kx / len, y: ky / len };
    }

    // 2) 触屏摇杆（相对拖动）
    if (touch.active) {
      const len = Math.hypot(touch.dx, touch.dy);
      if (len <= DEAD_ZONE) return { x: 0, y: 0 };
      const mag = Math.min(1, (len - DEAD_ZONE) / (KNOB_RANGE - DEAD_ZONE));
      return { x: (touch.dx / len) * mag, y: (touch.dy / len) * mag };
    }

    // 3) 鼠标：方向对准光标，离中心越远越快
    if (mouse.inside) {
      const rect = el.getBoundingClientRect();
      const dx = mouse.x - rect.width / 2;
      const dy = mouse.y - rect.height / 2;
      const len = Math.hypot(dx, dy);
      if (len < 12) return { x: 0, y: 0 };
      const mag = mouse.pressed ? 1 : Math.min(1, Math.max(0.15, (len - 12) / 110));
      return { x: dx / len, y: dy / len };
    }

    return { x: 0, y: 0 };
  }

  function dispose() {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("pointerleave", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    keys.clear();
  }

  return { dir, dispose };
}

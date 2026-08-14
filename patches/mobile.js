/* =====================================================================
 * dsh 移动端 JS 注入（由 apply-frontend.sh 注入到 index.html，
 * 必须在 <script type="module"> 之前执行）。
 * 包含：AbortSignal.any polyfill、tooltip 气泡重吸附、触摸交互增强。
 * ===================================================================== */

/* ---- 1) AbortSignal.any polyfill ----
 * 手机浏览器（老 Chrome/部分手机浏览器）不支持该新 API，工作区选择等请求会因此报错 */
if (typeof AbortSignal !== "undefined" && !AbortSignal.any) {
  AbortSignal.any = function (signals) {
    var controller = new AbortController();
    var first = Array.prototype.find.call(signals, function (s) { return s.aborted; });
    if (first) { controller.abort(first.reason); return controller.signal; }
    function onAbort() {
      if (controller.signal.aborted) return;
      var aborted = Array.prototype.find.call(signals, function (s) { return s.aborted; });
      controller.abort(aborted ? aborted.reason : undefined);
    }
    Array.prototype.forEach.call(signals, function (s) {
      if (s && typeof s.addEventListener === "function") s.addEventListener("abort", onAbort, { once: true });
    });
    return controller.signal;
  };
}

/* ---- 2) tooltip 气泡重吸附 ----
 * React 的 Tooltip 在 hover 时一次性计算锚点矩形，之后只在 window resize 时重定位；
 * 侧边栏展开/收起或滚动时锚点移动而气泡不跟随，导致 position:fixed 的气泡漂移。
 * 此脚本在气泡可见期间以 rAF 循环持续读取锚点(previousElementSibling)的实时矩形，
 * 把气泡钉在锚点右侧并垂直居中。 */
(function () {
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.MutationObserver) return;
  var GAP = 8;
  var MARGIN = 12;
  var rafId = 0;

  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }

  function place(bubble) {
    var anchor = bubble.previousElementSibling;
    if (!anchor) return;
    var a = anchor.getBoundingClientRect();
    if (a.width === 0 && a.height === 0) return;
    var b = bubble.getBoundingClientRect();
    var side = bubble.getAttribute("data-side") || "right";
    var left, top;
    if (side === "right") {
      left = a.right + GAP;
      top = a.top + (a.height - b.height) / 2;
    } else if (side === "top") {
      left = a.left + (a.width - b.width) / 2;
      top = a.top - b.height - GAP;
    } else if (side === "bottom") {
      left = a.left + (a.width - b.width) / 2;
      top = a.bottom + GAP;
    } else {
      left = a.left + (a.width - b.width) / 2;
      top = a.top + (a.height - b.height) / 2;
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    if (left + b.width > vw - MARGIN) left = vw - MARGIN - b.width;
    if (left < MARGIN) left = MARGIN;
    if (top + b.height > vh - MARGIN) top = vh - MARGIN - b.height;
    if (top < MARGIN) top = MARGIN;
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
  }

  function tick() {
    rafId = 0;
    var nodes = document.querySelectorAll("._bubble_owhem_8");
    var alive = false;
    for (var i = 0; i < nodes.length; i++) {
      if (!isVisible(nodes[i])) continue;
      alive = true;
      place(nodes[i]);
    }
    if (alive) rafId = requestAnimationFrame(tick);
  }

  function wake() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  try {
    var mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener("resize", wake);
  window.addEventListener("scroll", wake, true);
  wake();
})();

/* ---- 3) 移动端交互增强 ----
 * 1) Tooltip 气泡：触摸按下显示、松手即销毁（React 的 Tooltip 无 touchend 处理，气泡会常驻）。
 *    触摸时只恢复"被触摸锚点自己的气泡"，其它旧气泡(display:none)保持隐藏，
 *    避免长按 B 时 A 的残留气泡被一并显示。
 * 2) 侧边栏抽屉打开时，点击右侧遮罩空白区关闭抽屉。 */
(function () {
  if (typeof window === "undefined") return;

  function wakeAnchor() { window.dispatchEvent(new Event("resize")); }

  function showTouchedBubble(e) {
    var el = e.target;
    while (el && el.nodeType === 1) {
      var sib = el.nextElementSibling;
      if (sib && sib.classList && sib.classList.contains("_bubble_owhem_8")) {
        if (sib.style.display === "none") sib.style.display = "";
        wakeAnchor();
        return;
      }
      el = el.parentElement;
    }
  }
  function hideBubbles() {
    var nodes = document.querySelectorAll("._bubble_owhem_8");
    for (var i = 0; i < nodes.length; i++) nodes[i].style.display = "none";
  }
  document.addEventListener("touchstart", showTouchedBubble, true);
  document.addEventListener("touchend", function () {
    setTimeout(hideBubbles, 120);
  }, true);

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || !t.hasAttribute) return;
    if (!t.hasAttribute("data-shell-overlay")) return;
    var frame = t.parentElement;
    if (frame && frame.hasAttribute("data-details-collapsed") && !frame.hasAttribute("data-sidebar-collapsed")) {
      var toggle = document.querySelector(".hHd-Xa_toggle");
      if (toggle) toggle.click();
    }
  }, true);
})();

/* ---- 4) 点击作曲栏 "+" 号完全不唤起键盘 ----
 * + 号按钮(onMouseDown: keepFocus) 在 mousedown 时显式 refocus 作曲输入框
 * (.uV2eYG_input)，触摸端因此拉起键盘。此处触摸端在捕获阶段拦截 mousedown，
 * 阻止事件冒泡到 React 根(keepFocus 不执行)，键盘根本不出现；
 * 不影响 + 号自身的 click(开菜单)。blur 方案会让键盘闪一下，已弃用。 */
(function () {
  "use strict";
  var isTouch =
    (typeof window !== "undefined" && "ontouchstart" in window) ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0);
  if (!isTouch) return;
  function isAddButton(target) {
    return target && typeof target.closest === "function" && !!target.closest(".uV2eYG_add");
  }
  document.addEventListener("mousedown", function (e) {
    if (isAddButton(e.target)) {
      e.stopPropagation();   /* 阻止事件冒泡到 React 根，keepFocus 不执行 */
      e.preventDefault();
    }
  }, true);                  /* 捕获阶段，先于 React 根监听 */
})();

/* ---- 5) 子代理下拉吸附在触发器下方（实测 containing block 偏移） ----
 * position:fixed 的 containing block 可能是带 transform / contain /
 * content-visibility / zoom 的祖先，导致 JS 写入的 left/top 相对该祖先
 * 而非视口，菜单右边界因此超出屏幕。与其逐个猜测是哪种属性，不如每帧实测：
 * 把 left/top/transform 临时归零，getBoundingClientRect 读出固定定位的真实
 * 基准点（含一切 containing block 偏移），再据此换算目标坐标并在视口内 clamp。
 * 全程在同一同步帧内完成，不触发中间重绘，无闪屏。 */
(function () {
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.MutationObserver) return;
  var GAP = 5, MARGIN = 12, raf = 0;
  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  /* 实测 containing block 相对视口的偏移：临时归零后读出渲染坐标即得基准点 */
  function cbOffset(menu) {
    var pl = menu.style.left, pt = menu.style.top, pT = menu.style.transform;
    menu.style.left = "0px"; menu.style.top = "0px"; menu.style.transform = "none";
    var r = menu.getBoundingClientRect();
    menu.style.left = pl; menu.style.top = pt; menu.style.transform = pT;
    return { left: r.left, top: r.top };
  }
  function place() {
    var menu = document.querySelector(".h8S2Va_menu");
    if (!menu || !isVisible(menu)) return;
    var root = menu.parentElement;
    if (!root) return;
    var r = root.getBoundingClientRect();
    var m = menu.getBoundingClientRect();
    if (m.width === 0 && m.height === 0) return; /* 宽度未就绪时跳过，等下一帧 */
    var vw = window.innerWidth, vh = window.innerHeight;
    var vLeft = r.left, vTop = r.bottom + GAP;
    if (vLeft + m.width > vw - MARGIN) vLeft = Math.max(MARGIN, vw - MARGIN - m.width);
    if (vLeft < MARGIN) vLeft = MARGIN;
    if (vTop + m.height > vh - MARGIN) vTop = Math.max(MARGIN, vh - MARGIN - m.height);
    if (vTop < MARGIN) vTop = MARGIN;
    var cb = cbOffset(menu); /* 实测偏移，不再依赖属性猜测 */
    menu.style.left = (vLeft - cb.left) + "px";
    menu.style.top = (vTop - cb.top) + "px";
  }
  function tick() { raf = 0; place(); if (isVisible(document.querySelector(".h8S2Va_menu"))) raf = requestAnimationFrame(tick); }
  function wake() { if (!raf) raf = requestAnimationFrame(tick); }
  try {
    var mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener("resize", wake);
  window.addEventListener("scroll", wake, true);
  wake();
})();

/* ---- 6) 用量/上下文仪表（ContextMeter）面板：fixed + 视口内 clamp ----
 * .JObwrW_panel 原为 absolute;bottom:calc(100% + 8px);right:0;width:264px。
 * 移动端输入条换行（.uV2eYG_trailing{display:contents}）后该触发器不再贴右，
 * 面板自触发器右缘向左展开 264px 会越过左边界；且面板在 sticky 作曲栏内
 * 向上展开，会被滚动容器裁剪/遮挡。处理方式与第 5 节子代理菜单一致：
 * 每帧实测 containing block 偏移（含 transform/contain 祖先），把面板固定
 * 在触发器上方并在视口内 clamp；上方放不下时翻到触发器下方。 */
(function () {
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.MutationObserver) return;
  var GAP = 8, MARGIN = 12, raf = 0;
  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  function cbOffset(panel) {
    var pl = panel.style.left, pt = panel.style.top, pT = panel.style.transform;
    panel.style.left = "0px"; panel.style.top = "0px"; panel.style.transform = "none";
    var r = panel.getBoundingClientRect();
    panel.style.left = pl; panel.style.top = pt; panel.style.transform = pT;
    return { left: r.left, top: r.top };
  }
  function place() {
    var panel = document.querySelector(".JObwrW_panel");
    if (!panel || !isVisible(panel)) return;
    var root = panel.parentElement;
    if (!root) return;
    var r = root.getBoundingClientRect();
    var m = panel.getBoundingClientRect();
    if (m.width === 0 && m.height === 0) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var vLeft = r.right - m.width;                    /* 右缘对齐触发器右缘（原 right:0 语义） */
    if (vLeft + m.width > vw - MARGIN) vLeft = vw - MARGIN - m.width;
    if (vLeft < MARGIN) vLeft = MARGIN;
    var vTop = r.top - m.height - GAP;                /* 触发器上方（原 bottom:100% + 8px 语义） */
    if (vTop < MARGIN) {                              /* 上方放不下则翻到下方 */
      vTop = r.bottom + GAP;
      if (vTop + m.height > vh - MARGIN) vTop = Math.max(MARGIN, vh - MARGIN - m.height);
    }
    var cb = cbOffset(panel);
    panel.style.left = (vLeft - cb.left) + "px";
    panel.style.top = (vTop - cb.top) + "px";
  }
  function tick() { raf = 0; place(); if (isVisible(document.querySelector(".JObwrW_panel"))) raf = requestAnimationFrame(tick); }
  function wake() { if (!raf) raf = requestAnimationFrame(tick); }
  try {
    var mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener("resize", wake);
  window.addEventListener("scroll", wake, true);
  wake();
})();

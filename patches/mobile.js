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

/* ---- 5) 子代理下拉吸附在触发器下方 ----
 * position:fixed 脱离 overflow 容器裁剪，但用 rAF 持续把菜单定位到
 * .h8S2Va_root 的 rect 下方（贴合父元素，不是底部弹层）。 */
(function () {
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.MutationObserver) return;
  var GAP = 5, MARGIN = 8, raf = 0;
  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  function place() {
    var menu = document.querySelector(".h8S2Va_menu");
    if (!menu || !isVisible(menu)) return;
    var root = menu.parentElement;
    if (!root) return;
    var r = root.getBoundingClientRect();
    var m = menu.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = r.left, top = r.bottom + GAP;
    if (left + m.width > vw - MARGIN) left = Math.max(MARGIN, vw - MARGIN - m.width);
    if (left < MARGIN) left = MARGIN;
    if (top + m.height > vh - MARGIN) top = vh - MARGIN - m.height;
    if (top < MARGIN) top = MARGIN;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
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

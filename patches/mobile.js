/* =====================================================================
 * dsh 移动端 JS 注入（由 apply-frontend.sh 注入到 index.html，
 * 必须在 <script type="module"> 之前执行）。
 * 包含：AbortSignal.any polyfill、tooltip 气泡重吸附、触摸交互增强、
 * 子代理下拉/ContextMeter 面板 fixed 视口定位、IME 回车误发送拦截。
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

/* ---- 5) 子代理下拉：fixed 定位到触发器下方，视口内 clamp ----
 * 上游 .h8S2Va_menu 为 absolute;left:0;width:336px，移动端由 mobile.css
 * 改成 fixed，但 left/top/right/bottom 都是 !important，普通内联赋值压不过
 * （必须用 CSSOM setProperty(...,"important")：内联 !important > 样式表
 * !important）。本段按视口坐标直接定位：左对齐触发器左缘、位于触发器下方，
 * 左/右/下边界 clamp 在 [MARGIN, 视口-MARGIN] 内保证整体不出屏；
 * z-index:2147483647 提到最上层盖过一切内容；max-width(视口-24px) +
 * max-height:60vh + overflow-y:auto 约束尺寸。
 * containing block 兜底：仅当祖先链（parentElement 向上到 body，含 body）
 * 存在会改变 fixed 定位基准的属性（transform/perspective/contain/filter/
 * backdrop-filter/will-change 非默认值）时，才实测偏移补偿；否则直接写
 * 视口坐标（这正是"根据屏幕大小决定坐标"）。 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.MutationObserver) return;
  var GAP = 5, MARGIN = 12, raf = 0;
  var FIXED_CB_PROPS = ["transform", "perspective", "contain", "filter", "backdrop-filter", "will-change"];
  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  /* 祖先链上是否存在会改变 fixed containing block 的属性（el 向上到 body，含 body） */
  function hasFixedCBAncestor(el) {
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      var cs = window.getComputedStyle(n);
      for (var i = 0; i < FIXED_CB_PROPS.length; i++) {
        var v = cs.getPropertyValue(FIXED_CB_PROPS[i]);
        if (v && v !== "none" && v !== "auto") return true;
      }
      n = n.parentElement;
    }
    return false;
  }
  /* 实测 containing block 相对视口的偏移：临时归零后读出渲染坐标即得基准点 */
  function cbOffset(menu) {
    var pl = menu.style.getPropertyValue("left"), pt = menu.style.getPropertyValue("top"), pT = menu.style.transform;
    menu.style.setProperty("left", "0px", "important");
    menu.style.setProperty("top", "0px", "important");
    menu.style.transform = "none";
    var r = menu.getBoundingClientRect();
    menu.style.setProperty("left", pl, "important");
    menu.style.setProperty("top", pt, "important");
    menu.style.transform = pT;
    return { left: r.left, top: r.top };
  }
  function place() {
    var menu = document.querySelector(".h8S2Va_menu");
    if (!menu || !isVisible(menu)) return;
    var root = menu.parentElement;
    if (!root) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("right", "auto", "important");
    menu.style.setProperty("bottom", "auto", "important");
    menu.style.setProperty("z-index", "2147483647", "important");
    menu.style.setProperty("max-width", (vw - 2 * MARGIN) + "px", "important");
    menu.style.setProperty("max-height", Math.floor(vh * 0.6) + "px", "important");
    menu.style.setProperty("overflow-y", "auto", "important");
    var r = root.getBoundingClientRect();           /* 触发器视口坐标 */
    var m = menu.getBoundingClientRect();
    if (m.width === 0 && m.height === 0) return;    /* 尺寸未就绪时跳过，等下一帧 */
    var vLeft = r.left;                             /* 左对齐触发器左缘 */
    if (vLeft + m.width > vw - MARGIN) vLeft = Math.max(MARGIN, vw - MARGIN - m.width);
    if (vLeft < MARGIN) vLeft = MARGIN;
    var vTop = r.bottom + GAP;                      /* 触发器下方 */
    if (vTop + m.height > vh - MARGIN) vTop = Math.max(MARGIN, vh - MARGIN - m.height);
    if (vTop < MARGIN) vTop = MARGIN;
    if (hasFixedCBAncestor(menu.parentElement)) {
      var cb = cbOffset(menu);                      /* 仅 fixed-CB 祖先存在时才补偿 */
      menu.style.setProperty("left", (vLeft - cb.left) + "px", "important");
      menu.style.setProperty("top", (vTop - cb.top) + "px", "important");
    } else {
      menu.style.setProperty("left", vLeft + "px", "important");   /* 直接写视口坐标 */
      menu.style.setProperty("top", vTop + "px", "important");
    }
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

/* ---- 6) 用量/上下文仪表（ContextMeter）面板：JS 全控 fixed 定位，视口 clamp ----
 * .JObwrW_panel 插件样式为 absolute;bottom:calc(100% + 8px);right:0;width:264px。
 * 移动端输入条换行（.uV2eYG_trailing{display:contents}）后触发器不再贴右，
 * 向左展开会越过左边界；且面板在 sticky 作曲栏内向上展开会被滚动容器裁剪。
 * 与第 5 节同款方案：CSSOM setProperty(...,"important") 写入内联 !important
 * 压过 mobile.css 的 !important，显式 position:fixed + right/bottom:auto +
 * z-index:2147483647（最上层）+ max-height:60vh + overflow-y:auto +
 * max-width(视口-24px)（保证不超右边界）。
 * 坐标按视口计算：右缘对齐触发器右缘、优先放在触发器上方，上方放不下翻到
 * 下方，左/右/上/下都 clamp 在 [MARGIN, 视口-MARGIN] 内；
 * 仅当祖先链存在 fixed-CB 属性时才用实测偏移补偿，否则直接写视口坐标
 * （这正是用户建议的"显示在最上层，根据屏幕大小决定其相对坐标"）。 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.MutationObserver) return;
  var GAP = 8, MARGIN = 12, raf = 0;
  var FIXED_CB_PROPS = ["transform", "perspective", "contain", "filter", "backdrop-filter", "will-change"];
  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  /* 祖先链上是否存在会改变 fixed containing block 的属性（el 向上到 body，含 body） */
  function hasFixedCBAncestor(el) {
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      var cs = window.getComputedStyle(n);
      for (var i = 0; i < FIXED_CB_PROPS.length; i++) {
        var v = cs.getPropertyValue(FIXED_CB_PROPS[i]);
        if (v && v !== "none" && v !== "auto") return true;
      }
      n = n.parentElement;
    }
    return false;
  }
  function cbOffset(panel) {
    var pl = panel.style.getPropertyValue("left"), pt = panel.style.getPropertyValue("top"), pT = panel.style.transform;
    panel.style.setProperty("left", "0px", "important");
    panel.style.setProperty("top", "0px", "important");
    panel.style.transform = "none";
    var r = panel.getBoundingClientRect();
    panel.style.setProperty("left", pl, "important");
    panel.style.setProperty("top", pt, "important");
    panel.style.transform = pT;
    return { left: r.left, top: r.top };
  }
  function place() {
    var panel = document.querySelector(".JObwrW_panel");
    if (!panel || !isVisible(panel)) return;
    var root = panel.parentElement;
    if (!root) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.setProperty("bottom", "auto", "important");
    panel.style.setProperty("z-index", "2147483647", "important");       /* 最上层 */
    panel.style.setProperty("max-height", Math.floor(vh * 0.6) + "px", "important");
    panel.style.setProperty("overflow-y", "auto", "important");
    panel.style.setProperty("max-width", (vw - 2 * MARGIN) + "px", "important"); /* 保证不超右边界 */
    var r = root.getBoundingClientRect();           /* 触发器视口坐标 */
    var m = panel.getBoundingClientRect();
    if (m.width === 0 && m.height === 0) return;    /* 尺寸未就绪时跳过，等下一帧 */
    var vLeft = r.right - m.width;                  /* 右缘对齐触发器右缘（原 right:0 语义） */
    if (vLeft + m.width > vw - MARGIN) vLeft = Math.max(MARGIN, vw - MARGIN - m.width);
    if (vLeft < MARGIN) vLeft = MARGIN;
    var vTop = r.top - m.height - GAP;              /* 上方优先（原 bottom:100%+8px 语义） */
    if (vTop < MARGIN) vTop = r.bottom + GAP;       /* 上方放不下则翻到下方 */
    if (vTop + m.height > vh - MARGIN) vTop = Math.max(MARGIN, vh - MARGIN - m.height);
    if (vTop < MARGIN) vTop = MARGIN;
    if (hasFixedCBAncestor(panel.parentElement)) {
      var cb = cbOffset(panel);                     /* 仅 fixed-CB 祖先存在时才补偿 */
      panel.style.setProperty("left", (vLeft - cb.left) + "px", "important");
      panel.style.setProperty("top", (vTop - cb.top) + "px", "important");
    } else {
      panel.style.setProperty("left", vLeft + "px", "important");       /* 直接写视口坐标 */
      panel.style.setProperty("top", vTop + "px", "important");
    }
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

/* ---- 7) 输入法(IME)候选确认的 Enter 误触发发送 ----
 * React 作曲栏(.uV2eYG_input)已有 isComposing/keyCode===229 守卫，但部分
 * 安卓输入法在确认候选词后发出的 Enter 是普通 keydown（keyCode 13、
 * isComposing=false），守卫拦不住导致误发送。此处在捕获阶段
 * （document.addEventListener(..., true)，先于 React 根委托）拦截：
 * compositionend 后 300ms 内的 Enter 只 stopPropagation——事件到不了 React
 * 根委托，不触发发送；不 preventDefault，默认行为（确认候选/正常换行）保留。 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  var COMPOSING_WINDOW = 300;   /* compositionend 后的防误触窗口(ms) */
  var lastCompositionEnd = 0;
  function isComposerTarget(t) {
    if (!t || t.nodeType !== 1) return false;
    if (typeof t.closest === "function") {
      try { return !!t.closest(".uV2eYG_input, textarea"); } catch (e) { return false; }
    }
    /* 无 closest 环境：沿祖先链手工匹配类名/标签 */
    var n = t;
    while (n && n.nodeType === 1) {
      var cls = typeof n.className === "string" ? n.className : "";
      if (cls.indexOf("uV2eYG_input") !== -1 || n.tagName === "TEXTAREA") return true;
      n = n.parentElement;
    }
    return false;
  }
  try {
    document.addEventListener("compositionstart", function (e) {
      if (isComposerTarget(e.target)) lastCompositionEnd = 0;  /* 新组合开始，清掉旧结束戳 */
    }, true);
    document.addEventListener("compositionend", function (e) {
      if (isComposerTarget(e.target)) lastCompositionEnd = Date.now();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (!isComposerTarget(e.target)) return;
      if (e.isComposing || e.keyCode === 229 || (Date.now() - lastCompositionEnd < COMPOSING_WINDOW)) {
        e.stopPropagation();   /* 只拦截传播，不 preventDefault：确认候选/换行照常 */
      }
    }, true);
  } catch (err) {}
})();

// js/components/select.js
import { utils } from "../utils.js";

/**
 * Custom dark select (keyboard + mouse).
 * Usage:
 *   const viewSel = makeSelect({
 *     options: [{label:"Official FDR", value:"OFFICIAL"}, {label:"xFDR (model)", value:"XMODEL"}],
 *     value: "OFFICIAL",
 *     onChange: (val)=>{ /* ... *\/ }
 *   });
 *   toolbar.append(viewSel.el);
 *   viewSel.value   // getter
 *   viewSel.setValue("XMODEL") // setter (fires onChange)
 *   viewSel.onChange(fn)       // subscribe
 */
export function makeSelect({ options = [], value = null, onChange = null, width = null } = {}) {
  const state = {
    open: false,
    value: value ?? (options[0]?.value ?? ""),
    idx: Math.max(0, options.findIndex(o => o.value === value)),
    onChange
  };

  const btn = utils.el("button", { class: "cselect__btn", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" });
  const panel = utils.el("div", { class: "cselect__panel", role: "listbox", tabindex: "-1" });
  const root = utils.el("div", { class: "cselect", style: width ? `min-width:${width}` : "" }, [btn, panel]);

  function labelFor(val) {
    const o = options.find(o => o.value === val);
    return o ? o.label : String(val ?? "");
  }

  function renderPanel() {
    panel.innerHTML = "";
    options.forEach((opt, i) => {
      const row = utils.el("div", {
        class: "cselect__option",
        role: "option",
        "aria-selected": String(opt.value === state.value),
        "data-value": String(opt.value),
        tabindex: "-1"
      }, opt.label);
      if (i === state.idx) row.classList.add("is-active");
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectValue(opt.value);
      });
      row.addEventListener("mousemove", () => setIdx(i));
      panel.append(row);
    });
  }

  function open() {
    if (state.open) return;
    state.open = true;
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    renderPanel();
    requestAnimationFrame(() => {
      const active = panel.querySelector(".cselect__option.is-active");
      if (active) active.scrollIntoView({ block: "nearest" });
      panel.focus();
    });
    document.addEventListener("mousedown", outsideClose, { capture: true });
    document.addEventListener("keydown", keydownGlobal, { capture: true });
  }
  function close() {
    if (!state.open) return;
    state.open = false;
    root.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outsideClose, { capture: true });
    document.removeEventListener("keydown", keydownGlobal, { capture: true });
    btn.focus();
  }
  function outsideClose(e) {
    if (!root.contains(e.target)) close();
  }
  function setIdx(i) {
    state.idx = Math.max(0, Math.min(options.length - 1, i));
    panel.querySelectorAll(".cselect__option").forEach((el, j) => {
      el.classList.toggle("is-active", j === state.idx);
    });
  }
  function selectValue(val, fire = true) {
    state.value = val;
    btn.innerHTML = `${labelFor(val)}<span class="cselect__chev">▾</span>`;
    panel.querySelectorAll(".cselect__option").forEach(el => {
      el.setAttribute("aria-selected", String(el.dataset.value === String(val)));
    });
    if (fire && typeof state.onChange === "function") state.onChange(state.value);
    close();
  }

  function keydownGlobal(e) {
    if (!state.open) return;
    if (["ArrowDown","ArrowUp","Home","End","Enter"," " ,"Escape"].includes(e.key)) e.preventDefault();
    if (e.key === "ArrowDown") setIdx(state.idx + 1);
    if (e.key === "ArrowUp")   setIdx(state.idx - 1);
    if (e.key === "Home")      setIdx(0);
    if (e.key === "End")       setIdx(options.length - 1);
    if (e.key === "Enter" || e.key === " ") {
      const opt = options[state.idx]; if (opt) selectValue(opt.value);
    }
    if (e.key === "Escape") close();
  }

  btn.addEventListener("click", () => (state.open ? close() : open()));
  btn.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  // init
  btn.innerHTML = `${labelFor(state.value)}<span class="cselect__chev">▾</span>`;

  return {
    el: root,
    get value() { return state.value; },
    setValue(v) { const i = Math.max(0, options.findIndex(o => o.value === v)); state.idx = i; selectValue(v, false); },
    onChange(fn) { state.onChange = fn; }
  };
}

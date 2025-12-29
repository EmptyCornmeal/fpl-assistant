// js/components/tooltip.js
import { GLOSSARY } from "../glossary.js";

function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function regex(){
  const terms = Object.keys(GLOSSARY).sort((a,b)=>b.length-a.length);
  if (!terms.length) return null;
  return new RegExp(`\\b(?:${terms.map(esc).join("|")})\\b`, "g");
}

/**
 * Auto-position tooltip based on available viewport space
 * Adds appropriate CSS classes for flipping/alignment
 */
function positionTooltip(el){
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Remove existing position classes
  el.classList.remove("tooltip-bottom", "tooltip-left", "tooltip-right", "tooltip-flip-down");

  // Check vertical space - if near top, flip to bottom
  const topSpace = rect.top;
  const bottomSpace = vh - rect.bottom;

  if (topSpace < 120 && bottomSpace > topSpace) {
    el.classList.add("tooltip-bottom");
  }

  // Check horizontal space for alignment
  const leftSpace = rect.left;
  const rightSpace = vw - rect.right;

  if (leftSpace < 100) {
    el.classList.add("tooltip-left");
  } else if (rightSpace < 100) {
    el.classList.add("tooltip-right");
  }
}

function process(container){
  const re = regex();
  if (!re) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (["SCRIPT","STYLE","TEXTAREA","CANVAS"].includes(tag)) return NodeFilter.FILTER_REJECT;
      if (p.classList.contains("abbr-tip")) return NodeFilter.FILTER_REJECT;
      const val = node.nodeValue;
      if (!val || val.trim().length < 2) return NodeFilter.FILTER_REJECT;
      if (!re.test(val)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const tn of nodes){
    if (!tn || !tn.parentNode) continue;
    const txt = tn.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    txt.replace(re, (m, idx)=>{
      if (idx>last) frag.append(document.createTextNode(txt.slice(last, idx)));
      const span = document.createElement("span");
      span.className = "abbr-tip";
      span.dataset.tooltip = GLOSSARY[m] || m;
      // IMPORTANT: no span.title => avoids native browser tooltip duplication
      span.textContent = m;

      // Add mouseenter handler for auto-positioning
      span.addEventListener("mouseenter", () => positionTooltip(span));

      frag.append(span);
      last = idx + m.length;
      return m;
    });
    if (last < txt.length) frag.append(document.createTextNode(txt.slice(last)));
    if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
  }
}

export function initTooltips(container){
  try{ process(container); }catch(e){ /* swallow */ }
  const mo = new MutationObserver(muts=>{
    for (const m of muts){
      m.addedNodes.forEach(n=>{
        if (n.nodeType===1){
          try{ process(n); }catch(e){ /* swallow */ }
        }
      });
    }
  });
  mo.observe(container, { childList:true, subtree:true });
}

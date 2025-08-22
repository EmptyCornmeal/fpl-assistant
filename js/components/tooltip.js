// js/components/tooltip.js
import { GLOSSARY } from "../glossary.js";

function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function regex(){
  const terms = Object.keys(GLOSSARY).sort((a,b)=>b.length-a.length);
  if (!terms.length) return null;
  return new RegExp(`\\b(?:${terms.map(esc).join("|")})\\b`, "g");
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

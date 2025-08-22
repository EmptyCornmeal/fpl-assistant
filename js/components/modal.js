import { utils } from "../utils.js";

export function openModal(title, contentNode){
  const backdrop = utils.el("div",{class:"modal__backdrop"});
  const modal = utils.el("div",{class:"modal"});
  const head = utils.el("div",{class:"modal__head"});
  const ttl = utils.el("div",{class:"modal__title"}, title || "Details");
  const close = utils.el("button",{class:"modal__close", title:"Close"}, "×");
  const body = utils.el("div",{class:"modal__body"});

  close.addEventListener("click", ()=> document.body.removeChild(backdrop));
  backdrop.addEventListener("click", (e)=>{ if(e.target===backdrop) document.body.removeChild(backdrop); });

  head.append(ttl, close);
  body.append(contentNode);
  modal.append(head, body);
  backdrop.append(modal);
  document.body.append(backdrop);
}

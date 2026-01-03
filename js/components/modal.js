import { utils } from "../utils.js";

export function openModal(title, contentNode){
  const backdrop = utils.el("div",{class:"modal__backdrop", tabindex:"-1"});
  const modal = utils.el("div",{class:"modal"});
  const head = utils.el("div",{class:"modal__head"});
  const ttl = utils.el("div",{class:"modal__title"}, title || "Details");
  const close = utils.el("button",{class:"modal__close", title:"Close"}, "×");
  const body = utils.el("div",{class:"modal__body"});

  const removeModal = () => {
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
  };

  close.addEventListener("click", removeModal);
  backdrop.addEventListener("click", (e)=>{ if(e.target===backdrop) removeModal(); });
  backdrop.addEventListener("mousedown", (e)=>{ if(e.target===backdrop) removeModal(); });
  backdrop.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") removeModal();
  });

  head.append(ttl, close);
  body.append(contentNode);
  modal.append(head, body);
  backdrop.append(modal);
  document.body.append(backdrop);
}

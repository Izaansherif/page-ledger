function personCard(p, todayList) {
  const initial = [...(p.nameMissing ? "?" : String(p.name).trim())][0]?.toUpperCase() || "?";
  const ava = `<span class="pcard__ava${p.toCall ? " pcard__ava--due" : ""}" aria-hidden="true">${escapeHTML(initial)}</span>`;
  
  const money = p.due > 0 ? `<span class="money money--due">${ppl.fmtRupees(p.due)} due</span>` : 
                p.paid > 0 ? `<span class="money money--in">${ppl.fmtRupees(p.paid)} paid</span>` : `<span class="money money--none">Free</span>`;
  
  const contact = p.waOk ? `+${escapeHTML(p.digits)}` : escapeHTML(String(p.phone ?? "")) || "no phone";
  
  return `<article class="pcard${p.toCall ? " pcard--due" : ""}" role="listitem" data-key="${escapeAttr(p.key)}">
    <div class="pcard__line" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Open ${escapeAttr(p.name)} - call and message">
      <div class="pcard__who">
        <div class="pcard__avatar">${ava}</div>
        <div class="pcard__details">
          <h3 class="pcard__name">${p.nameMissing ? `Name missing <span class="chip chip--amber">check the page</span>` : escapeHTML(p.name)}</h3>
          <span class="pcard__contact">${escapeHTML(contact)}</span>
        </div>
      </div>
      <div class="pcard__money">${money}</div>
    </div>
    ${p.followUp && p.followUp.date < ppl.localToday() ? `<div class="pcard__overdue">Overdue since ${ppl.fmtRupees(p.due)}</div>` : ""}
  </article>`;
}

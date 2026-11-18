// In-game menu: a tabbed panel opened with I. Each <section class="pane" data-pane data-title> inside
// #menuBody becomes a tab, in document order, so adding a pane is just adding a section.
const $ = (id) => document.getElementById(id);

export function createMenu() {
  const root = $('menu');
  const panes = [...root.querySelectorAll('.pane')].map((el) => {
    const b = document.createElement('button');
    b.className = 'tab'; b.textContent = el.dataset.title;
    $('menuTabs').appendChild(b);
    return { id: el.dataset.pane, el, b };
  });
  const listeners = [];
  let active = 0, open = false;
  const emit = () => listeners.forEach((f) => f(open, panes[active].id));
  function show(i) {
    active = ((i % panes.length) + panes.length) % panes.length;
    panes.forEach((p, k) => { p.el.hidden = k !== active; p.b.classList.toggle('on', k === active); });
    $('menuBody').scrollTop = 0;
    emit();
  }
  function setOpen(v, id) {
    open = v; root.hidden = !v;
    const i = id ? panes.findIndex((p) => p.id === id) : -1;
    if (i >= 0) show(i); else emit();
  }
  panes.forEach((p, i) => { p.b.onclick = () => show(i); });
  $('menuClose').onclick = () => setOpen(false);
  root.addEventListener('mousedown', (e) => { if (e.target === root) setOpen(false); });   // click outside the card
  show(0);
  return {
    show, setOpen, cycle: (d) => show(active + d),
    showPane: (id) => show(panes.findIndex((p) => p.id === id)),
    onChange: (f) => listeners.push(f),
    get open() { return open; }, get pane() { return panes[active].id; },
  };
}

// Settings rows of segmented buttons: [{ label, hint?, options: [[value, text]], get(), set(v) }]
export function settingsPane(el, defs) {
  const rows = defs.map((d) => {
    const row = document.createElement('div'); row.className = 'setting';
    const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = d.label;
    if (d.hint) { const s = document.createElement('small'); s.textContent = d.hint; lbl.appendChild(s); }
    const seg = document.createElement('div'); seg.className = 'seg';
    const btns = d.options.map(([v, text]) => {
      const b = document.createElement('button'); b.textContent = text;
      b.onclick = () => { d.set(v); sync(); };
      seg.appendChild(b); return [v, b];
    });
    row.append(lbl, seg); el.appendChild(row);
    return { d, btns };
  });
  function sync() { for (const { d, btns } of rows) { const cur = d.get(); for (const [v, b] of btns) b.classList.toggle('on', v === cur); } }
  sync();
  return { sync };
}

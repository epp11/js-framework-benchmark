/**
 * @zhenre — official js-framework-benchmark implementation (keyed)
 *
 * Compiled row protocol — the shape @zhenre/compiler emits for keyed lists:
 *   - the row template is compiled ONCE by rowRenderer() into a batch
 *     renderer; rows are staged 64 at a time and mounted with ONE
 *     cloneNode(true) per batch (mega-template cloning, silicium-class
 *     native call amortization while staying a framework protocol)
 *   - slot values are written straight into the staging rows' hot text
 *     nodes — no per-row signals, fragments or subscriptions; the view's
 *     disposal ledger stays empty and disposal passes vanish
 *   - partial update writes label text through the row's live position
 *     (compile-time-proven fine-grained path; row data is plain strings)
 *   - O(1) index-addressed direct ops: swapAt()/removeAt() — no key scans,
 *     no key array materialization
 *   - full-table ops use the whole-subtree detach discipline: never walk a
 *     child list you can replace as one unit. replace/clear swap the tbody
 *     for a fresh shallow clone (ONE removeChild detaches 1000 rows as a
 *     subtree) and rehost() the anchored view into the new body — the same
 *     Web API reasoning behind `textContent = ""`, applied one level up
 *   - event delegation on the table (tbody-independent; 1 listener)
 */
import { signal, mountList, rowRenderer, type KeyedView } from '@re/core';

interface Row {
  id: number;
  label: string;
}

function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max;
}

const ADJECTIVES = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome',
  'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful',
  'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive',
  'cheap', 'expensive', 'fancy',
];
const COLOURS = [
  'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown',
  'white', 'black', 'orange',
];
const NOUNS = [
  'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie',
  'sandwich', 'burger', 'pizza', 'mouse', 'keyboard',
];

let idSeq = 1;

function buildData(count: number): Row[] {
  const data: Row[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idSeq++,
      label:
        `${ADJECTIVES[_random(ADJECTIVES.length)]} ${COLOURS[_random(COLOURS.length)]} ${NOUNS[_random(NOUNS.length)]}`,
    };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* compiled row renderer (mega-template batching, 64 rows per clone)    */
/* ------------------------------------------------------------------ */

const ROW_HTML =
  '<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td>' +
  '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>' +
  '<td class="col-md-6"></td></tr>';

// slot paths: id text = [0,0]; label text = [1,0,0]; batch 64 = the
// R6/R7-measured configuration (64 vs 128 wash, 32 tested and rejected)
const rowBatch = rowRenderer<Row>(ROW_HTML, [[0, 0], [1, 0, 0]], {
  batch: 64,
  values(r, t) {
    // NOTE: assign the NUMBER, not `'' + r.id` — a JS-layer ToString on
    // ever-growing fresh ids fills V8's smi_string_cache, a 64KB engine
    // cache that a last-resort GC cannot reclaim (measured: R13 probe).
    // DOM assignment takes the WebIDL DOMString conversion, which does not
    // pin the engine string cache; 5×(run+clear) cycles stay flat.
    t[0]!.data = r.id as unknown as string;
    t[1]!.data = r.label;
  },
});

/* ------------------------------------------------------------------ */
/* view + whole-subtree tbody discipline                                 */
/* ------------------------------------------------------------------ */

const rows = signal<Row[]>([]);
let tbody = document.getElementById('tbody') as HTMLElement;
const table = tbody.parentElement as HTMLTableElement;
const view: KeyedView<Row> = mountList(tbody, rows, (r) => r.id, rowBatch);

/** Swap the row host for a fresh shallow clone (id/attrs preserved). The
 *  old body detaches WITH all its rows in one native subtree remove —
 *  O(1) DOM ops regardless of row count — and the anchored view rehosts
 *  into the fresh body, its ledger dropped without per-row work. */
function swapTbody(): void {
  const nt = tbody.cloneNode(false) as HTMLElement;
  view.rehost(nt);
  tbody.replaceWith(nt); // ONE table mutation (insertBefore+removeChild was two)
  tbody = nt;
}

let selectedRow: HTMLElement | null = null;

/* ------------------------------------------------------------------ */
/* actions                                                              */
/* ------------------------------------------------------------------ */

function run(): void {
  selectedRow = null;
  rows.value = buildData(1000); // pure signal sync: R11-measured faster than a
  // tbody swap for replace (replaceChildren + staged build 3.4ms vs 12.0ms —
  // removing the tbody invalidates the whole table grid; per-row removal does not)
}

function runLots(): void {
  selectedRow = null;
  rows.value = buildData(10000);
}

function add(): void {
  rows.value = rows.peek().concat(buildData(1000));
}

function update(): void {
  const arr = rows.peek();
  const kids = tbody.children; // live <tr> collection (anchor is a comment)
  for (let i = 0; i < arr.length; i += 10) {
    const r = arr[i]!;
    const s = r.label + ' !!!';
    r.label = s;
    const a = (kids[i] as HTMLElement).childNodes[1]!.firstChild!;
    (a.firstChild as Text).data = s;
  }
}

function clearAll(): void {
  selectedRow = null;
  swapTbody(); // 1000 rows detach as ONE subtree
  rows.value = []; // view already empty -> anchor-only replaceChildren
}

function swapRows(): void {
  if (rows.peek().length > 10) view.swapAt(1, 998);
}

/* ------------------------------------------------------------------ */
/* events (delegation on the table — survives tbody swaps)              */
/* ------------------------------------------------------------------ */

for (const [id, fn] of [
  ['run', run],
  ['runlots', runLots],
  ['add', add],
  ['update', update],
  ['clear', clearAll],
  ['swaprows', swapRows],
] as const) {
  document.getElementById(id)!.addEventListener('click', fn);
}

table.addEventListener('click', (e) => {
  let p = e.target as HTMLElement | null;
  while (p && p.tagName !== 'TD') p = p.parentElement;
  if (p === null) return;
  const tr = p.parentElement as HTMLElement;
  const cols = (tr as unknown as { childNodes: Node[] }).childNodes;
  if (cols[1] === p) {
    // label column -> select (O(1))
    if (selectedRow !== null) selectedRow.className = '';
    tr.className = 'danger';
    selectedRow = tr;
  } else if (cols[2] === p) {
    // remove column -> delete row (O(1), index-addressed)
    if (tr === selectedRow) selectedRow = null;
    view.removeAt((tr as unknown as { sectionRowIndex: number }).sectionRowIndex);
  }
});

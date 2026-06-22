import './style.css';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

type StoreName = 'workbooks' | 'cards' | 'cycles';

type Workbook = {
  id: string;
  name: string;
  createdAt: number;
  cardIds: string[];
};

type Card = {
  id: string;
  workbookId: string;
  number: number;
  questionImage: string;
  solutionImage: string;
  rating: number;
  note: string;
  drawingImage: string;
  attempts: number;
  lastMs: number;
};

type Cycle = {
  id: string;
  name: string;
  createdAt: number;
  queue: string[];
  totalStart: number;
  correct: number;
  wrong: number;
  done: boolean;
};

type View = 'books' | 'cycles' | 'card' | 'solve';

type AppState = {
  view: View;
  selectedWorkbookId: string | null;
  selectedCardId: string | null;
  activeCycleId: string | null;
  revealed: boolean;
  timerStart: number;
  elapsedMs: number;
  parsing: boolean;
  parseLog: string;
  parseProgress: number;
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const DB_NAME = 'math-card-personal-v1';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;
let workbooksCache: Workbook[] = [];
let cardsCache: Card[] = [];
let cyclesCache: Cycle[] = [];

const state: AppState = {
  view: 'books',
  selectedWorkbookId: null,
  selectedCardId: null,
  activeCycleId: null,
  revealed: false,
  timerStart: 0,
  elapsedMs: 0,
  parsing: false,
  parseLog: '',
  parseProgress: 0
};

const T = {
  title: '\uc218\ud559 \uce74\ub4dc',
  books: '\ubb38\uc81c\uc9d1',
  cycles: '\uc0ac\uc774\ud074',
  importPdf: 'PDF \ub123\uae30',
  reset: '\uc804\uccb4 \uc0ad\uc81c',
  noBooks: '\uc544\uc9c1 \ubb38\uc81c\uc9d1\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. PDF\ub97c \ub123\uc5b4\uc8fc\uc138\uc694.',
  cards: '\uce74\ub4dc',
  solve: '\ubb38\uc81c \ud480\uae30',
  replaceQ: '\ubb38\uc81c \uc774\ubbf8\uc9c0 \uad50\uccb4',
  replaceS: '\ud574\uc124 \uc774\ubbf8\uc9c0 \uad50\uccb4',
  back: '\ub4a4\ub85c',
  question: '\ubb38\uc81c',
  solution: '\ud574\uc124',
  reveal: '\ud574\uc124\ubcf4\uae30',
  correct: '\ub9de\uc74c',
  wrong: '\ud2c0\ub9bc',
  rating: '\ub09c\uc774\ub3c4',
  note: '\uba54\ubaa8',
  drawing: '\ub4dc\ub85c\uc789',
  clearDrawing: '\uadf8\ub9bc \uc9c0\uc6b0\uae30',
  newCycle: '\uc0c8 \uc0ac\uc774\ud074',
  start: '\uc2dc\uc791',
  continue: '\uc774\uc5b4 \ud480\uae30',
  order: '\uc21c\uc11c',
  sequential: '\uc21c\uc11c\ub300\ub85c',
  random: '\ub79c\ub364',
  filter: '\ubcc4\uc810 \ud544\ud130',
  allRatings: '\uc804\uccb4',
  parsing: 'PDF \ubd84\uc11d \uc911',
  done: '\uc644\ub8cc',
  elapsed: '\uc18c\uc694\uc2dc\uac04',
  emptyCycle: '\uc0ac\uc774\ud074\uc5d0 \ub0a8\uc740 \ubb38\uc81c\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.',
  selectBook: '\ubb38\uc81c\uc9d1\uc744 \uc120\ud0dd\ud558\uc138\uc694.',
  parsingTip: '\uc608\uc2dc PDF\ucc98\ub7fc \ubb38\uc81c \ud398\uc774\uc9c0\ub294 1. 2. 3. \ud615\uc2dd, \ud574\uc124 \ud398\uc774\uc9c0\ub294 \u30101\u3011 \ub610\ub294 (1) \ud615\uc2dd\uc744 \uae30\uc900\uc73c\ub85c \uc790\ub3d9 \uce74\ub4dc\ud654\ud569\ub2c8\ub2e4.'
};

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function msToText(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['workbooks', 'cards', 'cycles']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise<TValue>(req: IDBRequest<TValue>): Promise<TValue> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll<TValue>(storeName: StoreName): Promise<TValue[]> {
  const db = await openDB();
  return reqToPromise<TValue[]>(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function getOne<TValue>(storeName: StoreName, id: string): Promise<TValue | undefined> {
  const db = await openDB();
  return reqToPromise<TValue | undefined>(db.transaction(storeName, 'readonly').objectStore(storeName).get(id));
}

async function putOne<TValue extends { id: string }>(storeName: StoreName, value: TValue): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteOne(storeName: StoreName, id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearDB(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['workbooks', 'cards', 'cycles'], 'readwrite');
  tx.objectStore('workbooks').clear();
  tx.objectStore('cards').clear();
  tx.objectStore('cycles').clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function refresh(): Promise<void> {
  workbooksCache = await getAll<Workbook>('workbooks');
  cardsCache = await getAll<Card>('cards');
  cyclesCache = await getAll<Cycle>('cycles');
  workbooksCache.sort((a, b) => b.createdAt - a.createdAt);
  cardsCache.sort((a, b) => a.number - b.number);
  cyclesCache.sort((a, b) => b.createdAt - a.createdAt);
}

function cardById(id: string | null): Card | undefined {
  if (!id) return undefined;
  return cardsCache.find(c => c.id === id);
}

function workbookById(id: string | null): Workbook | undefined {
  if (!id) return undefined;
  return workbooksCache.find(w => w.id === id);
}

function cycleById(id: string | null): Cycle | undefined {
  if (!id) return undefined;
  return cyclesCache.find(c => c.id === id);
}

function selectedWorkbookCards(): Card[] {
  const wb = workbookById(state.selectedWorkbookId);
  if (!wb) return [];
  const ids = new Set(wb.cardIds);
  return cardsCache.filter(c => ids.has(c.id)).sort((a, b) => a.number - b.number);
}

function renderShell(content: string, subtitle = ''): void {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <h1>MathCard</h1>
        <p>${esc(subtitle || T.parsingTip)}</p>
      </header>
      <main class="content">${content}</main>
      <nav class="nav">
        <button class="${state.view === 'books' || state.view === 'card' || (state.view === 'solve' && !state.activeCycleId) ? 'active' : ''}" id="navBooks">${T.books}</button>
        <button class="${state.view === 'cycles' || (state.view === 'solve' && state.activeCycleId) ? 'active' : ''}" id="navCycles">${T.cycles}</button>
      </nav>
    </div>
  `;
  document.querySelector('#navBooks')?.addEventListener('click', () => {
    state.view = 'books';
    state.activeCycleId = null;
    state.selectedCardId = null;
    state.revealed = false;
    render();
  });
  document.querySelector('#navCycles')?.addEventListener('click', () => {
    state.view = 'cycles';
    state.selectedCardId = null;
    state.activeCycleId = null;
    state.revealed = false;
    render();
  });
}

function renderBooks(): void {
  const wbList = workbooksCache.map(wb => {
    const count = wb.cardIds.length;
    const active = state.selectedWorkbookId === wb.id ? 'active' : '';
    return `<button class="card-tile ${active}" data-wb="${esc(wb.id)}"><strong>${esc(wb.name)}</strong><span class="small">${count} ${T.cards}</span></button>`;
  }).join('');
  const selected = workbookById(state.selectedWorkbookId) ?? workbooksCache[0];
  if (!state.selectedWorkbookId && selected) state.selectedWorkbookId = selected.id;
  const cardTiles = selectedWorkbookCards().map(c => `
    <button class="card-tile" data-card="${esc(c.id)}">
      <strong>#${c.number}</strong>
      <span class="small">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span>
    </button>
  `).join('');
  const content = `
    <section class="card">
      <h2>${T.importPdf}</h2>
      <p class="small">${T.parsingTip}</p>
      <input type="file" accept="application/pdf,.pdf" id="pdfInput" ${state.parsing ? 'disabled' : ''} />
      <div class="row" style="margin-top:10px">
        <button class="secondary" id="resetBtn">${T.reset}</button>
      </div>
      ${state.parsing || state.parseLog ? `
        <div style="margin-top:12px" class="progress-wrap"><div class="progress-bar" style="width:${Math.round(state.parseProgress * 100)}%"></div></div>
        <div style="margin-top:10px" class="logbox">${esc(state.parseLog)}</div>
      ` : ''}
    </section>
    <section class="card">
      <h2>${T.books}</h2>
      ${workbooksCache.length ? `<div class="grid">${wbList}</div>` : `<p>${T.noBooks}</p>`}
    </section>
    ${selected ? `
      <section class="card">
        <div class="row tight"><h2>${esc(selected.name)} ${T.cards}</h2><span class="badge">${selected.cardIds.length}</span></div>
        <div class="grid">${cardTiles || `<p>${T.noBooks}</p>`}</div>
      </section>
    ` : ''}
  `;
  renderShell(content, T.books);
  document.querySelector('#pdfInput')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await handlePdfImport(file);
  });
  document.querySelector('#resetBtn')?.addEventListener('click', async () => {
    if (confirm('Delete all local data?')) {
      await clearDB();
      state.selectedWorkbookId = null;
      state.selectedCardId = null;
      state.activeCycleId = null;
      state.parseLog = '';
      await refresh();
      render();
    }
  });
  document.querySelectorAll<HTMLElement>('[data-wb]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedWorkbookId = el.dataset.wb || null;
      render();
    });
  });
  document.querySelectorAll<HTMLElement>('[data-card]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedCardId = el.dataset.card || null;
      state.view = 'card';
      render();
    });
  });
}

function renderCardDetail(): void {
  const card = cardById(state.selectedCardId);
  if (!card) {
    state.view = 'books';
    render();
    return;
  }
  const content = `
    <section class="card">
      <div class="row tight">
        <button class="secondary" id="backBooks">${T.back}</button>
        <h2>#${card.number}</h2>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="solveCard">${T.solve}</button>
        <label class="buttonlike"><input type="file" accept="image/*" id="replaceQ" class="hidden"> <button class="secondary" id="replaceQBtn" type="button">${T.replaceQ}</button></label>
        <label class="buttonlike"><input type="file" accept="image/*" id="replaceS" class="hidden"> <button class="secondary" id="replaceSBtn" type="button">${T.replaceS}</button></label>
      </div>
    </section>
    <section class="card">
      <h3>${T.question}</h3>
      <img class="preview-img" src="${card.questionImage}" />
    </section>
    <section class="card">
      <h3>${T.solution}</h3>
      ${card.solutionImage ? `<img class="preview-img" src="${card.solutionImage}" />` : `<p class="small">No solution image.</p>`}
    </section>
  `;
  renderShell(content, `#${card.number}`);
  document.querySelector('#backBooks')?.addEventListener('click', () => { state.view = 'books'; render(); });
  document.querySelector('#solveCard')?.addEventListener('click', () => startSolving(card.id, null));
  document.querySelector('#replaceQBtn')?.addEventListener('click', () => (document.querySelector('#replaceQ') as HTMLInputElement).click());
  document.querySelector('#replaceSBtn')?.addEventListener('click', () => (document.querySelector('#replaceS') as HTMLInputElement).click());
  document.querySelector('#replaceQ')?.addEventListener('change', async (e) => replaceCardImage(card.id, 'questionImage', (e.target as HTMLInputElement).files?.[0]));
  document.querySelector('#replaceS')?.addEventListener('change', async (e) => replaceCardImage(card.id, 'solutionImage', (e.target as HTMLInputElement).files?.[0]));
}

async function replaceCardImage(cardId: string, field: 'questionImage' | 'solutionImage', file?: File): Promise<void> {
  if (!file) return;
  const card = await getOne<Card>('cards', cardId);
  if (!card) return;
  card[field] = await imageFileToDataUrl(file);
  await putOne('cards', card);
  await refresh();
  render();
}

function renderCycles(): void {
  const workbookOptions = workbooksCache.map(wb => `
    <label class="check-row"><input type="checkbox" name="cycleWb" value="${esc(wb.id)}"> <span>${esc(wb.name)} <span class="small">(${wb.cardIds.length})</span></span></label>
  `).join('');
  const cycleList = cyclesCache.map(cyc => `
    <div class="card">
      <div class="row tight"><h3>${esc(cyc.name)}</h3>${cyc.done ? `<span class="badge">${T.done}</span>` : `<span class="badge">${cyc.queue.length}/${cyc.totalStart}</span>`}</div>
      <p class="small">O ${cyc.correct} / X ${cyc.wrong}</p>
      <button data-cycle="${esc(cyc.id)}" ${cyc.done ? 'disabled' : ''}>${T.continue}</button>
    </div>
  `).join('');
  const content = `
    <section class="card">
      <h2>${T.newCycle}</h2>
      ${workbooksCache.length ? `
        <div class="checkbox-list">${workbookOptions}</div>
        <div style="margin-top:10px" class="row">
          <label>${T.order}<select id="cycleOrder"><option value="seq">${T.sequential}</option><option value="rand">${T.random}</option></select></label>
        </div>
        <div style="margin-top:10px">
          <p class="small">${T.filter}</p>
          <div class="row tight">
            ${[0,1,2,3,4,5].map(r => `<label class="check-row"><input type="checkbox" name="ratingFilter" value="${r}"> ${r === 0 ? T.allRatings : `${r}★`}</label>`).join('')}
          </div>
        </div>
        <button style="margin-top:12px" id="startCycle">${T.start}</button>
      ` : `<p>${T.noBooks}</p>`}
    </section>
    <section>${cycleList || `<div class="card"><p class="small">No saved cycles.</p></div>`}</section>
  `;
  renderShell(content, T.cycles);
  document.querySelector('#startCycle')?.addEventListener('click', startNewCycle);
  document.querySelectorAll<HTMLElement>('[data-cycle]').forEach(el => {
    el.addEventListener('click', () => continueCycle(el.dataset.cycle || ''));
  });
}

async function startNewCycle(): Promise<void> {
  const wbIds = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="cycleWb"]:checked')).map(x => x.value);
  if (!wbIds.length) {
    alert(T.selectBook);
    return;
  }
  const filterRaw = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ratingFilter"]:checked')).map(x => Number(x.value));
  const useFilter = filterRaw.length > 0 && !filterRaw.includes(0);
  const order = (document.querySelector('#cycleOrder') as HTMLSelectElement).value;
  const sourceIds = new Set<string>();
  for (const wbId of wbIds) {
    const wb = workbookById(wbId);
    wb?.cardIds.forEach(id => sourceIds.add(id));
  }
  let ids = cardsCache.filter(c => sourceIds.has(c.id) && (!useFilter || filterRaw.includes(c.rating))).sort((a, b) => a.number - b.number).map(c => c.id);
  if (order === 'rand') ids = shuffle(ids);
  if (!ids.length) {
    alert('No cards matched.');
    return;
  }
  const cycle: Cycle = {
    id: uid('cycle'),
    name: `${new Date().toLocaleString()} (${ids.length})`,
    createdAt: Date.now(),
    queue: ids,
    totalStart: ids.length,
    correct: 0,
    wrong: 0,
    done: false
  };
  await putOne('cycles', cycle);
  await refresh();
  continueCycle(cycle.id);
}

function shuffle<TValue>(arr: TValue[]): TValue[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function continueCycle(cycleId: string): Promise<void> {
  const cycle = await getOne<Cycle>('cycles', cycleId);
  if (!cycle || cycle.done || cycle.queue.length === 0) return;
  startSolving(cycle.queue[0], cycle.id);
}

function startSolving(cardId: string, cycleId: string | null): void {
  state.view = 'solve';
  state.selectedCardId = cardId;
  state.activeCycleId = cycleId;
  state.revealed = false;
  state.elapsedMs = 0;
  state.timerStart = performance.now();
  render();
}

function renderSolve(): void {
  const card = cardById(state.selectedCardId);
  if (!card) {
    state.view = state.activeCycleId ? 'cycles' : 'books';
    render();
    return;
  }
  const cycle = cycleById(state.activeCycleId);
  const subtitle = cycle ? `${T.cycles} ${cycle.totalStart - cycle.queue.length + 1}/${cycle.totalStart}` : `#${card.number}`;
  const stars = [1,2,3,4,5].map(n => `<button data-star="${n}">${n <= card.rating ? '★' : '☆'}</button>`).join('');
  const content = `
    <section class="solve-toolbar">
      <div class="row tight">
        <button class="secondary" id="closeSolve">${T.back}</button>
        <span class="badge">#${card.number}</span>
        <span class="badge" id="timerBadge">${T.elapsed} ${msToText(state.revealed ? state.elapsedMs : performance.now() - state.timerStart)}</span>
      </div>
    </section>
    <section class="solve-body ${state.revealed ? 'revealed' : ''}">
      <div class="solve-panel card">
        <h3>${T.question}</h3>
        <img class="solve-img" src="${card.questionImage}" />
      </div>
      <div class="solve-panel solution-panel card">
        <h3>${T.solution}</h3>
        ${card.solutionImage ? `<img class="solve-img" src="${card.solutionImage}" />` : `<p>No solution image.</p>`}
      </div>
    </section>
    ${state.revealed ? `
      <section class="card">
        <h3>${T.rating}</h3>
        <div class="stars">${stars}</div>
        <h3>${T.note}</h3>
        <textarea id="noteInput">${esc(card.note)}</textarea>
        <h3>${T.drawing}</h3>
        <div class="canvas-wrap"><canvas id="drawCanvas"></canvas></div>
        <button class="secondary" style="margin-top:10px" id="clearDrawing">${T.clearDrawing}</button>
        <div class="row" style="margin-top:12px">
          <button class="ok" id="markCorrect">${T.correct}</button>
          <button class="danger" id="markWrong">${T.wrong}</button>
        </div>
      </section>
    ` : `
      <section class="card"><button id="revealBtn">${T.reveal}</button></section>
    `}
  `;
  renderShell(content, subtitle);
  document.querySelector('#closeSolve')?.addEventListener('click', () => {
    state.view = state.activeCycleId ? 'cycles' : 'card';
    state.revealed = false;
    render();
  });
  if (!state.revealed) {
    const interval = window.setInterval(() => {
      if (state.view !== 'solve' || state.revealed) {
        window.clearInterval(interval);
        return;
      }
      const badge = document.querySelector('#timerBadge');
      if (badge) badge.textContent = `${T.elapsed} ${msToText(performance.now() - state.timerStart)}`;
    }, 500);
    document.querySelector('#revealBtn')?.addEventListener('click', () => {
      state.elapsedMs = performance.now() - state.timerStart;
      state.revealed = true;
      render();
    });
  } else {
    setupDrawingCanvas(card);
    document.querySelectorAll<HTMLElement>('[data-star]').forEach(el => {
      el.addEventListener('click', async () => {
        const fresh = await getOne<Card>('cards', card.id);
        if (!fresh) return;
        fresh.rating = Number(el.dataset.star);
        await putOne('cards', fresh);
        await refresh();
        render();
      });
    });
    document.querySelector('#clearDrawing')?.addEventListener('click', () => clearCanvas());
    document.querySelector('#markCorrect')?.addEventListener('click', () => finishAnswer(true));
    document.querySelector('#markWrong')?.addEventListener('click', () => finishAnswer(false));
  }
}

async function finishAnswer(correct: boolean): Promise<void> {
  const card = await getOne<Card>('cards', state.selectedCardId || '');
  if (!card) return;
  card.note = (document.querySelector('#noteInput') as HTMLTextAreaElement | null)?.value ?? card.note;
  card.drawingImage = getCanvasDataUrl() || card.drawingImage;
  card.attempts += 1;
  card.lastMs = state.elapsedMs;
  await putOne('cards', card);

  if (state.activeCycleId) {
    const cycle = await getOne<Cycle>('cycles', state.activeCycleId);
    if (cycle) {
      const current = cycle.queue.shift();
      if (correct) cycle.correct += 1;
      else {
        cycle.wrong += 1;
        if (current) cycle.queue.push(current);
      }
      if (cycle.queue.length === 0) cycle.done = true;
      await putOne('cycles', cycle);
      await refresh();
      if (cycle.done) {
        alert(T.done);
        state.view = 'cycles';
        state.selectedCardId = null;
        state.activeCycleId = null;
        state.revealed = false;
        render();
        return;
      }
      startSolving(cycle.queue[0], cycle.id);
      return;
    }
  }
  await refresh();
  state.view = 'card';
  state.revealed = false;
  render();
}

function render(): void {
  if (state.view === 'books') renderBooks();
  else if (state.view === 'cycles') renderCycles();
  else if (state.view === 'card') renderCardDetail();
  else renderSolve();
}

function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

let drawCtx: CanvasRenderingContext2D | null = null;
let drawing = false;
let lastPoint: { x: number; y: number } | null = null;

function setupDrawingCanvas(card: Card): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#drawCanvas');
  if (!canvas) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(240 * ratio);
  drawCtx = canvas.getContext('2d');
  if (!drawCtx) return;
  drawCtx.scale(ratio, ratio);
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, rect.width, 240);
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.lineWidth = 3;
  drawCtx.strokeStyle = '#111827';
  if (card.drawingImage) {
    const img = new Image();
    img.onload = () => drawCtx?.drawImage(img, 0, 0, rect.width, 240);
    img.src = card.drawingImage;
  }
  const point = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  canvas.onpointerdown = (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    drawing = true;
    lastPoint = point(ev);
  };
  canvas.onpointermove = (ev) => {
    if (!drawing || !drawCtx || !lastPoint) return;
    const p = point(ev);
    drawCtx.beginPath();
    drawCtx.moveTo(lastPoint.x, lastPoint.y);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
    lastPoint = p;
  };
  canvas.onpointerup = () => { drawing = false; lastPoint = null; };
  canvas.onpointercancel = () => { drawing = false; lastPoint = null; };
}

function clearCanvas(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#drawCanvas');
  if (!canvas || !drawCtx) return;
  const r = canvas.getBoundingClientRect();
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, r.width, 240);
}

function getCanvasDataUrl(): string {
  const canvas = document.querySelector<HTMLCanvasElement>('#drawCanvas');
  if (!canvas) return '';
  return canvas.toDataURL('image/jpeg', 0.82);
}

type TextItemLite = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
};

type LineLite = {
  pageNum: number;
  cellIndex: number;
  col: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  items: TextItemLite[];
};

type AnchorType = 'question' | 'solution';
type AnchorStyle = 'question-dot' | 'corner' | 'paren' | 'square';

type Anchor = {
  type: AnchorType;
  style: AnchorStyle;
  number: number;
  pageNum: number;
  cellIndex: number;
  col: number;
  x: number;
  y: number;
  h: number;
  lineText: string;
  score: number;
};

type PageInfo = {
  pageNum: number;
  width: number;
  height: number;
  items: TextItemLite[];
  lines: LineLite[];
  questionCandidates: Anchor[];
  solutionCandidates: Anchor[];
  hasQuestionPage: boolean;
};

type Segment = {
  key: string;
  type: AnchorType;
  number: number;
  pageNum: number;
  col: number;
  y1: number;
  y2: number;
  order: number;
};

type ParsedCardImages = {
  number: number;
  questionImage: string;
  solutionImage: string;
};

async function handlePdfImport(file: File): Promise<void> {
  state.parsing = true;
  state.parseProgress = 0;
  state.parseLog = `${T.parsing}: ${file.name}\n`;
  render();
  try {
    const cards = await parsePdfToImages(file, (msg, progress) => {
      state.parseLog += `${msg}\n`;
      state.parseProgress = progress;
      render();
    });
    if (!cards.length) throw new Error('No matched cards. Check PDF layout.');
    const wb: Workbook = {
      id: uid('wb'),
      name: file.name.replace(/\.pdf$/i, ''),
      createdAt: Date.now(),
      cardIds: []
    };
    for (const parsed of cards) {
      const card: Card = {
        id: uid('card'),
        workbookId: wb.id,
        number: parsed.number,
        questionImage: parsed.questionImage,
        solutionImage: parsed.solutionImage,
        rating: 0,
        note: '',
        drawingImage: '',
        attempts: 0,
        lastMs: 0
      };
      wb.cardIds.push(card.id);
      await putOne('cards', card);
    }
    await putOne('workbooks', wb);
    await refresh();
    state.selectedWorkbookId = wb.id;
    state.parseLog += `${T.done}: ${cards.length} cards\n`;
  } catch (err) {
    console.error(err);
    state.parseLog += `ERROR: ${(err as Error).message}\n`;
  } finally {
    state.parsing = false;
    state.parseProgress = 1;
    await refresh();
    render();
  }
}

function normalizeText(s: string): string {
  return String(s || '')
    .replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\uFF0E\u3002]/g, '.')
    .replace(/[\uFF08]/g, '(')
    .replace(/[\uFF09]/g, ')')
    .replace(/[\u3014\u3016\u3018]/g, '[')
    .replace(/[\u3015\u3017\u3019]/g, ']')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDecorativeLine(text: string): boolean {
  const n = normalizeText(text);
  if (!n) return true;
  if (/^-\s*\d{1,4}\s*-$/.test(n)) return true;
  if (/^\[?정답\]?$/.test(n)) return true;
  if (/^Topic\s*\d/i.test(n)) return true;
  if (/^Part[-\s]*\d/i.test(n)) return true;
  return false;
}

function colBounds(page: PageInfo | { width: number; height: number }, col: number): { x1: number; x2: number; top: number; bottom: number } {
  const gap = Math.max(10, page.width * 0.018);
  const top = Math.max(8, page.height * 0.010);
  const bottom = page.height - Math.max(32, page.height * 0.030);
  if (col === 0) return { x1: 0, x2: page.width / 2 - gap, top, bottom };
  return { x1: page.width / 2 + gap, x2: page.width, top, bottom };
}

function lineSort(a: LineLite, b: LineLite): number {
  return a.cellIndex - b.cellIndex || a.y - b.y || a.x - b.x;
}

function anchorSort(a: Anchor, b: Anchor): number {
  return a.cellIndex - b.cellIndex || a.y - b.y || a.x - b.x || a.number - b.number;
}

function buildLines(pageNum: number, width: number, height: number, items: TextItemLite[]): LineLite[] {
  const lines: LineLite[] = [];
  for (const col of [0, 1]) {
    const colItems = items.filter(it => it.col === col).sort((a, b) => a.y - b.y || a.x - b.x);
    const groups: TextItemLite[][] = [];
    for (const item of colItems) {
      const cy = item.y + item.h / 2;
      const last = groups[groups.length - 1];
      if (last) {
        const lastCy = last.reduce((sum, it) => sum + it.y + it.h / 2, 0) / last.length;
        const lastH = Math.max(...last.map(it => it.h));
        const tol = Math.max(3.2, Math.min(9, Math.max(lastH, item.h) * 0.55));
        if (Math.abs(cy - lastCy) <= tol) {
          last.push(item);
          continue;
        }
      }
      groups.push([item]);
    }
    for (const group of groups) {
      group.sort((a, b) => a.x - b.x);
      const minX = Math.min(...group.map(it => it.x));
      const minY = Math.min(...group.map(it => it.y));
      const maxX = Math.max(...group.map(it => it.x + it.w));
      const maxY = Math.max(...group.map(it => it.y + it.h));
      const parts: string[] = [];
      let prevRight: number | null = null;
      for (const it of group) {
        const gap = prevRight === null ? 0 : it.x - prevRight;
        if (gap > Math.max(2.2, it.h * 0.20)) parts.push(' ');
        parts.push(it.str);
        prevRight = it.x + it.w;
      }
      const text = normalizeText(parts.join(''));
      if (!text) continue;
      lines.push({
        pageNum,
        cellIndex: (pageNum - 1) * 2 + col,
        col,
        text,
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        items: group
      });
    }
  }
  return lines.sort(lineSort);
}

function gapAbove(line: LineLite, lines: LineLite[]): number {
  const previous = lines
    .filter(l => l.col === line.col && l.y < line.y && !isDecorativeLine(l.text))
    .sort((a, b) => b.y - a.y)[0];
  if (!previous) return 999;
  return line.y - (previous.y + previous.h);
}

function scoreLeftIndent(page: PageInfo | { width: number; height: number }, line: LineLite): number {
  const b = colBounds(page, line.col);
  const colWidth = Math.max(1, b.x2 - b.x1);
  const indent = Math.max(0, line.x - b.x1);
  const ratio = indent / colWidth;
  if (ratio <= 0.16) return 18;
  if (ratio <= 0.26) return 10;
  if (ratio <= 0.36) return 2;
  return -25;
}

function detectQuestionAnchor(page: PageInfo, line: LineLite): Anchor | null {
  const text = normalizeText(line.text);
  const m = text.match(/^(\d{1,4})\s*\.\s*(?=\S|$)/);
  if (!m) return null;
  const number = Number(m[1]);
  if (!Number.isFinite(number) || number < 1 || number > 9999) return null;
  const b = colBounds(page, line.col);
  const colWidth = Math.max(1, b.x2 - b.x1);
  const indentRatio = Math.max(0, line.x - b.x1) / colWidth;
  if (indentRatio > 0.42) return null;
  let score = 70 + scoreLeftIndent(page, line);
  if (line.h >= 10) score += 3;
  if (/^\d{1,4}\s*\.\s*$/.test(text)) score -= 8;
  return {
    type: 'question',
    style: 'question-dot',
    number,
    pageNum: line.pageNum,
    cellIndex: line.cellIndex,
    col: line.col,
    x: line.x,
    y: line.y,
    h: line.h,
    lineText: line.text,
    score
  };
}

function detectSolutionAnchor(page: PageInfo, line: LineLite): Anchor | null {
  const text = normalizeText(line.text);
  const patterns: Array<{ style: AnchorStyle; re: RegExp; weight: number }> = [
    { style: 'corner', re: /^【\s*(\d{1,4})\s*】/, weight: 70 },
    { style: 'paren', re: /^\(\s*(\d{1,4})\s*\)/, weight: 36 },
    { style: 'square', re: /^\[\s*(\d{1,4})\s*\]/, weight: 34 }
  ];
  for (const pat of patterns) {
    const m = text.match(pat.re);
    if (!m) continue;
    const number = Number(m[1]);
    if (!Number.isFinite(number) || number < 1 || number > 9999) return null;
    const b = colBounds(page, line.col);
    const colWidth = Math.max(1, b.x2 - b.x1);
    const indentRatio = Math.max(0, line.x - b.x1) / colWidth;
    if (indentRatio > 0.52) return null;
    const gap = gapAbove(line, page.lines);
    let score = pat.weight + scoreLeftIndent(page, line);
    if (/정답|답\s*[:;]|sol\)?|풀이|해설/i.test(text)) score += 34;
    if (gap > 24) score += 18;
    else if (gap > 10) score += 8;
    else if (gap < -2) score -= 8;
    if (text.length <= 42) score += 4;
    if (/^\(\d+\)\s*[가-힣a-zA-Z]/.test(text) && !/정답|답\s*[:;]|sol\)?|풀이|해설/i.test(text)) score -= 24;
    return {
      type: 'solution',
      style: pat.style,
      number,
      pageNum: line.pageNum,
      cellIndex: line.cellIndex,
      col: line.col,
      x: line.x,
      y: line.y,
      h: line.h,
      lineText: line.text,
      score
    };
  }
  return null;
}

function selectMonotonicAnchors(candidates: Anchor[], maxNumber?: number): Anchor[] {
  const arr = candidates
    .filter(c => c.number >= 1 && (!maxNumber || c.number <= maxNumber))
    .sort(anchorSort);
  if (!arr.length) return [];
  const n = arr.length;
  const dp = new Array<number>(n).fill(0);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    dp[i] = Math.max(1, arr[i].score);
    for (let j = 0; j < i; j++) {
      if (arr[j].number >= arr[i].number) continue;
      const jump = arr[i].number - arr[j].number;
      const continuity = jump === 1 ? 14 : jump <= 4 ? 3 : -Math.min(30, Math.log2(jump) * 5);
      const candidateScore = dp[j] + Math.max(1, arr[i].score) + continuity;
      if (candidateScore > dp[i]) {
        dp[i] = candidateScore;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (dp[i] > dp[best]) best = i;
  const selected: Anchor[] = [];
  for (let cur = best; cur >= 0; cur = prev[cur]) selected.push(arr[cur]);
  selected.reverse();
  return selected;
}

function chooseSolutionStyle(candidates: Anchor[], maxNumber?: number): AnchorStyle | null {
  const styles: AnchorStyle[] = ['corner', 'paren', 'square'];
  let bestStyle: AnchorStyle | null = null;
  let bestQuality = -Infinity;
  for (const style of styles) {
    const subset = candidates.filter(c => c.style === style && (!maxNumber || c.number <= maxNumber));
    if (!subset.length) continue;
    const seq = selectMonotonicAnchors(subset, maxNumber);
    const unique = new Set(seq.map(c => c.number)).size;
    const keywordHits = seq.filter(c => /정답|답\s*[:;]|sol\)?|풀이|해설/i.test(normalizeText(c.lineText))).length;
    const quality = unique * 100 + keywordHits * 18 + seq.reduce((sum, c) => sum + c.score, 0) / Math.max(1, seq.length);
    if (quality > bestQuality) {
      bestQuality = quality;
      bestStyle = style;
    }
  }
  return bestStyle;
}

function pageByNum(pages: PageInfo[], pageNum: number): PageInfo {
  const p = pages[pageNum - 1];
  if (!p) throw new Error(`Missing page ${pageNum}`);
  return p;
}

function hasRealContent(page: PageInfo, col: number, y1: number, y2: number): boolean {
  return page.lines.some(line => line.col === col && line.y + line.h > y1 && line.y < y2 && !isDecorativeLine(line.text));
}

function firstContentY(page: PageInfo, col: number, y1: number, y2: number): number | null {
  const line = page.lines
    .filter(l => l.col === col && l.y + l.h > y1 && l.y < y2 && !isDecorativeLine(l.text))
    .sort((a, b) => a.y - b.y)[0];
  return line ? line.y : null;
}

function lastContentBottom(page: PageInfo, col: number, y1: number, y2: number): number | null {
  const line = page.lines
    .filter(l => l.col === col && l.y + l.h > y1 && l.y < y2 && !isDecorativeLine(l.text))
    .sort((a, b) => b.y - a.y)[0];
  return line ? line.y + line.h : null;
}

function allowedCellSet(pages: PageInfo[], type: AnchorType, anchors: Anchor[]): Set<number> {
  const allowed = new Set<number>();
  if (!anchors.length) return allowed;
  const firstPage = Math.min(...anchors.map(a => a.pageNum));
  const lastPage = Math.max(...anchors.map(a => a.pageNum));
  for (const page of pages) {
    if (type === 'question') {
      if (page.hasQuestionPage && page.pageNum >= firstPage && page.pageNum <= lastPage) {
        allowed.add((page.pageNum - 1) * 2);
        allowed.add((page.pageNum - 1) * 2 + 1);
      }
    } else {
      if (!page.hasQuestionPage && page.pageNum >= firstPage) {
        allowed.add((page.pageNum - 1) * 2);
        allowed.add((page.pageNum - 1) * 2 + 1);
      }
    }
  }
  return allowed;
}

function buildSegments(anchors: Anchor[], pages: PageInfo[], type: AnchorType): Segment[] {
  const segments: Segment[] = [];
  const sorted = anchors.sort(anchorSort);
  if (!sorted.length) return segments;
  const allowed = allowedCellSet(pages, type, sorted);
  const allowedCells = Array.from(allowed).sort((a, b) => a - b);
  const lastAllowedCell = allowedCells[allowedCells.length - 1] ?? sorted[sorted.length - 1].cellIndex;
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = sorted[i + 1] || null;
    const key = `${type}:${start.number}`;
    const endCellLimit = end ? end.cellIndex : lastAllowedCell;
    let order = 0;
    for (let cell = start.cellIndex; cell <= endCellLimit; cell++) {
      if (!allowed.has(cell)) continue;
      const pageNum = Math.floor(cell / 2) + 1;
      const col = cell % 2;
      const page = pageByNum(pages, pageNum);
      const bounds = colBounds(page, col);
      let y1 = bounds.top;
      let y2 = bounds.bottom;
      if (cell === start.cellIndex) {
        y1 = Math.max(bounds.top, start.y - Math.max(6, start.h * 0.45));
      } else {
        const firstY = firstContentY(page, col, bounds.top, bounds.bottom);
        if (firstY === null) continue;
        y1 = Math.max(bounds.top, firstY - 8);
      }
      if (end && cell === end.cellIndex) {
        y2 = Math.min(bounds.bottom, end.y - Math.max(5, end.h * 0.35));
      } else {
        const lastBottom = lastContentBottom(page, col, y1, bounds.bottom);
        if (lastBottom !== null) y2 = Math.min(bounds.bottom, lastBottom + 10);
      }
      if (!hasRealContent(page, col, y1, y2)) continue;
      if (y2 - y1 > 22) {
        segments.push({ key, type, number: start.number, pageNum, col, y1, y2, order: order++ });
      }
    }
  }
  return segments;
}

async function parsePdfToImages(file: File, log: (msg: string, progress: number) => void): Promise<ParsedCardImages[]> {
  const data = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data }).promise;
  const pages: PageInfo[] = [];
  const pageCount = pdf.numPages;
  log(`pages: ${pageCount}`, 0.02);

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const width = viewport.width;
    const height = viewport.height;
    const items: TextItemLite[] = [];
    for (const raw of text.items as any[]) {
      if (!raw.str || !String(raw.str).trim()) continue;
      const tr = (pdfjsLib as any).Util.transform(viewport.transform, raw.transform);
      const x = Number(tr[4]) || 0;
      const yBase = Number(tr[5]) || 0;
      const h = Math.max(4, Math.abs(Number(raw.height || tr[3] || 10)));
      const y = Math.max(0, yBase - h);
      const w = Math.max(1, Math.abs(Number(raw.width || tr[0] || 10)));
      items.push({ str: String(raw.str), x, y, w, h, col: x < width / 2 ? 0 : 1 });
    }
    const pageInfo: PageInfo = {
      pageNum: i,
      width,
      height,
      items,
      lines: [],
      questionCandidates: [],
      solutionCandidates: [],
      hasQuestionPage: false
    };
    pageInfo.lines = buildLines(i, width, height, items);
    pageInfo.questionCandidates = pageInfo.lines
      .map(line => detectQuestionAnchor(pageInfo, line))
      .filter((a): a is Anchor => Boolean(a));
    pageInfo.hasQuestionPage = pageInfo.questionCandidates.length > 0;
    if (!pageInfo.hasQuestionPage) {
      pageInfo.solutionCandidates = pageInfo.lines
        .map(line => detectSolutionAnchor(pageInfo, line))
        .filter((a): a is Anchor => Boolean(a));
    }
    pages.push(pageInfo);
    if (i % 5 === 0 || i === pageCount) log(`scan ${i}/${pageCount}`, 0.02 + 0.30 * (i / pageCount));
  }

  const qCandidates = pages.flatMap(p => p.questionCandidates).sort(anchorSort);
  const questions = selectMonotonicAnchors(qCandidates).sort(anchorSort);
  const maxQuestionNumber = questions.length ? Math.max(...questions.map(q => q.number)) : undefined;
  const rawSolutionCandidates = pages.flatMap(p => p.solutionCandidates).filter(s => !maxQuestionNumber || s.number <= maxQuestionNumber + 5).sort(anchorSort);
  const chosenStyle = chooseSolutionStyle(rawSolutionCandidates, maxQuestionNumber ? maxQuestionNumber + 5 : undefined);
  const solutionCandidates = chosenStyle ? rawSolutionCandidates.filter(s => s.style === chosenStyle) : rawSolutionCandidates;
  const solutions = selectMonotonicAnchors(solutionCandidates, maxQuestionNumber ? maxQuestionNumber + 5 : undefined).sort(anchorSort);

  log(`anchors: question ${questions.length}/${qCandidates.length}, solution ${solutions.length}/${rawSolutionCandidates.length}${chosenStyle ? ` style=${chosenStyle}` : ''}`, 0.35);

  const qSegments = buildSegments(questions, pages, 'question');
  const sSegments = buildSegments(solutions, pages, 'solution');
  log(`segments: question ${qSegments.length}, solution ${sSegments.length}`, 0.38);

  const chunks = await renderSegments(pdf, pages, [...qSegments, ...sSegments], log);
  const questionMap = await mergeChunks(chunks, 'question', log, 0.82, 0.90);
  const solutionMap = await mergeChunks(chunks, 'solution', log, 0.90, 0.98);

  const result: ParsedCardImages[] = [];
  const nums = Array.from(questionMap.keys()).sort((a, b) => a - b);
  for (const num of nums) {
    const qImg = questionMap.get(num) || '';
    const sImg = solutionMap.get(num) || '';
    if (qImg) result.push({ number: num, questionImage: qImg, solutionImage: sImg });
  }
  log(`matched: ${result.filter(x => x.solutionImage).length}/${result.length}`, 1);
  return result;
}

type ChunkEntry = {
  key: string;
  type: AnchorType;
  number: number;
  order: number;
  dataUrl: string;
};

async function renderSegments(pdf: any, pages: PageInfo[], segments: Segment[], log: (msg: string, progress: number) => void): Promise<ChunkEntry[]> {
  const chunks: ChunkEntry[] = [];
  const byPage = new Map<number, Segment[]>();
  for (const seg of segments) {
    if (!byPage.has(seg.pageNum)) byPage.set(seg.pageNum, []);
    byPage.get(seg.pageNum)!.push(seg);
  }
  const pageNums = Array.from(byPage.keys()).sort((a, b) => a - b);
  const renderScale = 2.0;
  for (let idx = 0; idx < pageNums.length; idx++) {
    const pageNum = pageNums[idx];
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pageInfo = pageByNum(pages, pageNum);
    for (const seg of byPage.get(pageNum)!) {
      const b = colBounds(pageInfo, seg.col);
      const sx = Math.max(0, Math.floor(b.x1 * renderScale));
      const sy = Math.max(0, Math.floor(seg.y1 * renderScale));
      const sw = Math.min(canvas.width - sx, Math.ceil((b.x2 - b.x1) * renderScale));
      const sh = Math.min(canvas.height - sy, Math.ceil((seg.y2 - seg.y1) * renderScale));
      if (sw < 20 || sh < 20) continue;
      const crop = document.createElement('canvas');
      crop.width = sw;
      crop.height = sh;
      crop.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const trimmed = trimCanvas(crop, 246, Math.round(12 * renderScale));
      if (trimmed.width > 20 && trimmed.height > 20) {
        chunks.push({ key: seg.key, type: seg.type, number: seg.number, order: seg.order, dataUrl: trimmed.toDataURL('image/jpeg', 0.86) });
      }
    }
    log(`render ${idx + 1}/${pageNums.length}`, 0.40 + 0.40 * ((idx + 1) / Math.max(1, pageNums.length)));
  }
  return chunks;
}

function trimCanvas(source: HTMLCanvasElement, threshold = 246, pad = 18): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < threshold || g < threshold || b < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX || minY > maxY) return source;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function mergeChunks(chunks: ChunkEntry[], type: AnchorType, log: (msg: string, progress: number) => void, startP: number, endP: number): Promise<Map<number, string>> {
  const map = new Map<number, ChunkEntry[]>();
  for (const c of chunks.filter(x => x.type === type)) {
    if (!map.has(c.number)) map.set(c.number, []);
    map.get(c.number)!.push(c);
  }
  const out = new Map<number, string>();
  const nums = Array.from(map.keys()).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    const num = nums[i];
    const items = map.get(num)!.sort((a, b) => a.order - b.order);
    out.set(num, await mergeDataUrls(items.map(x => x.dataUrl)));
    if (i % 20 === 0 || i === nums.length - 1) log(`merge ${type} ${i + 1}/${nums.length}`, startP + (endP - startP) * ((i + 1) / Math.max(1, nums.length)));
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

async function mergeDataUrls(urls: string[]): Promise<string> {
  if (urls.length === 0) return '';
  if (urls.length === 1) return urls[0];
  const imgs = await Promise.all(urls.map(loadImage));
  const width = Math.max(...imgs.map(i => i.width));
  const gap = 18;
  const height = imgs.reduce((sum, img) => sum + img.height, 0) + gap * (imgs.length - 1);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const img of imgs) {
    ctx.drawImage(img, 0, y);
    y += img.height + gap;
  }
  return canvas.toDataURL('image/jpeg', 0.86);
}


(async function boot() {
  await refresh();
  render();
})();

import './style.css';
import { App as CapacitorApp } from '@capacitor/app';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

type StoreName = 'workbooks' | 'cards' | 'cycles';
type AnswerState = 'correct' | 'wrong';

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
  drawingImage: string;
  attempts: number;
  lastMs: number;
  lastResult?: AnswerState | null;
};

type CycleHistoryEntry = { cardId: string; answer: AnswerState };

type Cycle = {
  id: string;
  name: string;
  createdAt: number;
  queue: string[];
  totalStart: number;
  correct: number;
  wrong: number;
  done: boolean;
  order?: 'seq' | 'rand';
  workbookNames?: string[];
  wrongIds?: string[];
  history?: CycleHistoryEntry[];
};

type View = 'books' | 'cycles' | 'card' | 'solve' | 'wrongList';

type AppState = {
  view: View;
  selectedWorkbookId: string | null;
  selectedCardId: string | null;
  activeCycleId: string | null;
  selectedCycleId: string | null;
  pendingAnswer: AnswerState | null;
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
  selectedCycleId: null,
  pendingAnswer: null,
  revealed: false,
  timerStart: 0,
  elapsedMs: 0,
  parsing: false,
  parseLog: '',
  parseProgress: 0
};

const T = {
  appName: 'Math Cycle',
  kicker: '온디바이스 수학 트레이너',
  books: '문제집 관리',
  cycles: '학습 사이클',
  importPdf: 'PDF 넣기',
  reset: '전체 삭제',
  noBooks: '아직 문제집이 없습니다. PDF를 넣어주세요.',
  cards: '문항',
  solve: '문제 풀기',
  replaceQ: '문제 이미지 교체',
  replaceS: '해설 이미지 교체',
  back: '뒤로',
  question: '문제',
  solution: '해설',
  reveal: '해설보기',
  correct: '맞음',
  wrong: '틀림',
  drawing: '드로잉',
  clearDrawing: '그림 지우기',
  newCycle: '사이클 제작',
  start: '시작',
  continue: '계속 학습',
  wrongCards: '오답 문항',
  delete: '삭제',
  prevProblem: '이전 문제',
  nextProblem: '다음 문제',
  order: '출제 순서',
  sequential: '순서대로',
  random: '랜덤',
  cycleName: '사이클 이름',
  problemCount: '문항 수',
  progress: '진행도',
  parsing: 'PDF 분석 중',
  done: '완료',
  elapsed: '소요시간',
  emptyCycle: '사이클에 남은 문제가 없습니다.',
  selectBook: '문제집을 선택하세요.',
  selectResult: '맞음/틀림을 먼저 선택하세요.',
  exitAsk: '앱을 종료할까요?',
  parsingTip: '문제는 큰 문항 번호, 해설은 정답 표지 번호를 기준으로 자동 카드화합니다.'
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


type ShellNavMode = 'main' | 'pager' | 'none';

type PagerInfo = {
  prevLabel: string;
  nextLabel: string;
  prevDisabled: boolean;
  nextDisabled: boolean;
};

function renderShell(content: string, subtitle = '', navMode?: ShellNavMode): void {
  const mode: ShellNavMode = navMode ?? ((state.view === 'card' || state.view === 'solve') ? 'pager' : 'main');
  const headerHtml = mode === 'main' ? renderMainHeader() : renderDetailHeader(subtitle);
  const navHtml = mode === 'pager' ? renderPagerNav() : '';
  app.innerHTML = `
    <div class="app-shell ${mode === 'main' ? 'main-shell' : 'detail-shell'}">
      ${headerHtml}
      <main class="content">${content}</main>
      ${navHtml}
    </div>
  `;
  if (mode === 'pager') attachPagerNav();
  if (mode === 'main') attachMainNav();
}

function renderMainHeader(): string {
  return `
    <header class="hero">
      <div class="hero-top">
        <div>
          <p class="kicker">${T.kicker}</p>
          <h1>${T.appName}</h1>
        </div>
        <div class="hero-actions">
          <button class="icon-btn" id="headerImport" title="${T.importPdf}">✎</button>
          <button class="icon-btn plus" id="headerNewCycle" title="${T.newCycle}">+</button>
        </div>
      </div>
      <nav class="top-tabs">
        <button class="${state.view === 'cycles' ? 'active' : ''}" id="navCycles">${T.cycles}</button>
        <button class="${state.view === 'books' ? 'active' : ''}" id="navBooks">${T.books}</button>
      </nav>
    </header>
  `;
}

function renderDetailHeader(subtitle: string): string {
  return `
    <header class="detail-topbar">
      <button class="ghost back-small" id="topBackBtn">‹</button>
      <div>
        <p class="kicker">${T.appName}</p>
        <h1>${esc(subtitle || '')}</h1>
      </div>
    </header>
  `;
}

function attachMainNav(): void {
  document.querySelector('#navBooks')?.addEventListener('click', () => {
    state.view = 'books';
    state.activeCycleId = null;
    state.selectedCycleId = null;
    state.selectedCardId = null;
    state.revealed = false;
    state.pendingAnswer = null;
    render();
  });
  document.querySelector('#navCycles')?.addEventListener('click', () => {
    state.view = 'cycles';
    state.selectedCardId = null;
    state.activeCycleId = null;
    state.revealed = false;
    state.pendingAnswer = null;
    render();
  });
  document.querySelector('#headerImport')?.addEventListener('click', () => {
    state.view = 'books';
    render();
    window.setTimeout(() => (document.querySelector('#pdfInput') as HTMLInputElement | null)?.click(), 50);
  });
  document.querySelector('#headerNewCycle')?.addEventListener('click', () => {
    state.view = 'cycles';
    render();
    window.setTimeout(() => showCycleCreateSheet(), 50);
  });
}

function renderPagerNav(): string {
  const info = getPagerInfo();
  return `
    <nav class="nav nav-pager">
      <button class="secondary" id="navPrev" ${info.prevDisabled ? 'disabled' : ''}>${info.prevLabel}</button>
      <button id="navNext" ${info.nextDisabled ? 'disabled' : ''}>${info.nextLabel}</button>
    </nav>
  `;
}

function getPagerInfo(): PagerInfo {
  const card = cardById(state.selectedCardId);
  const cycle = cycleById(state.activeCycleId);
  const prevCard = card ? adjacentCardFor(card, -1) : undefined;
  const nextCard = card ? adjacentCardFor(card, 1) : undefined;

  if (state.view === 'solve') {
    if (cycle) {
      const history = normalizeCycle(cycle).history || [];
      return {
        prevLabel: T.prevProblem,
        nextLabel: state.revealed ? T.nextProblem : T.reveal,
        prevDisabled: history.length === 0,
        nextDisabled: false
      };
    }
    return {
      prevLabel: T.prevProblem,
      nextLabel: state.revealed ? T.nextProblem : T.reveal,
      prevDisabled: !prevCard,
      nextDisabled: state.revealed ? !nextCard : false
    };
  }

  return {
    prevLabel: T.prevProblem,
    nextLabel: T.nextProblem,
    prevDisabled: !prevCard,
    nextDisabled: !nextCard
  };
}

function attachPagerNav(): void {
  document.querySelector('#navPrev')?.addEventListener('click', () => void handlePagerPrev());
  document.querySelector('#navNext')?.addEventListener('click', () => void handlePagerNext());
  document.querySelector('#topBackBtn')?.addEventListener('click', () => void handleBackIntent());
}

function workbookCardsForCard(card: Card): Card[] {
  const selected = workbookById(state.selectedWorkbookId);
  const selectedHasCard = selected?.cardIds.includes(card.id);
  const wb = selectedHasCard ? selected : workbookById(card.workbookId);
  if (!wb) return [];
  const ids = new Set(wb.cardIds);
  return cardsCache.filter(c => ids.has(c.id)).sort((a, b) => a.number - b.number);
}

function adjacentCardFor(card: Card, delta: -1 | 1): Card | undefined {
  const cards = workbookCardsForCard(card);
  const idx = cards.findIndex(c => c.id === card.id);
  if (idx < 0) return undefined;
  return cards[idx + delta];
}


function normalizeCycle(cycle: Cycle): Cycle {
  cycle.order = cycle.order || 'seq';
  cycle.workbookNames = cycle.workbookNames || [];
  cycle.wrongIds = cycle.wrongIds || [];
  cycle.history = cycle.history || [];
  cycle.correct = Number(cycle.correct || 0);
  cycle.wrong = Number(cycle.wrong || 0);
  cycle.totalStart = Number(cycle.totalStart || cycle.queue?.length || 0);
  cycle.queue = Array.isArray(cycle.queue) ? cycle.queue : [];
  cycle.done = Boolean(cycle.done);
  return cycle;
}

function recomputeWrongIds(cycle: Cycle): void {
  const wrong = new Set<string>();
  for (const h of cycle.history || []) if (h.answer === 'wrong') wrong.add(h.cardId);
  cycle.wrongIds = Array.from(wrong);
}

async function saveVisibleSolveFeedback(): Promise<void> {
  if (state.view !== 'solve' || !state.selectedCardId) return;
  const card = await getOne<Card>('cards', state.selectedCardId);
  if (!card) return;
  const drawing = getCanvasDataUrl();
  if (drawing) card.drawingImage = drawing;
  if (state.elapsedMs) card.lastMs = state.elapsedMs;
  if (state.pendingAnswer) card.lastResult = state.pendingAnswer;
  await putOne('cards', card);
  await refresh();
}

async function revealCurrent(): Promise<void> {
  await saveVisibleSolveFeedback();
  state.elapsedMs = performance.now() - state.timerStart;
  state.revealed = true;
  render();
}

async function navigateAdjacent(delta: -1 | 1): Promise<void> {
  const current = cardById(state.selectedCardId);
  if (!current) return;
  const next = adjacentCardFor(current, delta);
  if (!next) return;
  await saveVisibleSolveFeedback();
  state.selectedWorkbookId = next.workbookId;
  state.selectedCardId = next.id;
  state.pendingAnswer = next.lastResult || null;
  if (state.view === 'solve') {
    startSolving(next.id, null);
  } else {
    render();
  }
}

async function undoCyclePrevious(): Promise<void> {
  if (!state.activeCycleId) return;
  const cycle = await getOne<Cycle>('cycles', state.activeCycleId);
  if (!cycle) return;
  normalizeCycle(cycle);
  const last = cycle.history!.pop();
  if (!last) return;
  if (last.answer === 'correct') cycle.correct = Math.max(0, cycle.correct - 1);
  else cycle.wrong = Math.max(0, cycle.wrong - 1);
  if (last.answer === 'wrong') {
    const idx = cycle.queue.lastIndexOf(last.cardId);
    if (idx >= 0) cycle.queue.splice(idx, 1);
  }
  cycle.queue.unshift(last.cardId);
  cycle.done = false;
  recomputeWrongIds(cycle);
  await putOne('cycles', cycle);
  await refresh();
  state.selectedCardId = last.cardId;
  state.pendingAnswer = last.answer;
  state.revealed = true;
  state.elapsedMs = 0;
  state.timerStart = performance.now();
  render();
}

async function handlePagerPrev(): Promise<void> {
  if (state.view === 'solve' && state.activeCycleId) {
    await saveVisibleSolveFeedback();
    await undoCyclePrevious();
    return;
  }
  await navigateAdjacent(-1);
}

async function handlePagerNext(): Promise<void> {
  if (state.view === 'solve') {
    if (!state.revealed) {
      await revealCurrent();
      return;
    }
    if (state.activeCycleId) {
      if (!state.pendingAnswer) {
        alert(T.selectResult);
        return;
      }
      await commitCycleAnswer(state.pendingAnswer);
      return;
    }
  }
  await navigateAdjacent(1);
}

async function markResult(answer: AnswerState): Promise<void> {
  state.pendingAnswer = answer;
  const card = await getOne<Card>('cards', state.selectedCardId || '');
  if (card) {
    card.lastResult = answer;
    const drawing = getCanvasDataUrl();
    if (drawing) card.drawingImage = drawing;
    await putOne('cards', card);
    await refresh();
  }
  render();
}

async function commitCycleAnswer(answer: AnswerState): Promise<void> {
  const cardId = state.selectedCardId;
  if (!cardId || !state.activeCycleId) return;
  await saveVisibleSolveFeedback();
  const card = await getOne<Card>('cards', cardId);
  if (card) {
    card.attempts += 1;
    card.lastMs = state.elapsedMs;
    card.lastResult = answer;
    await putOne('cards', card);
  }
  const cycle = await getOne<Cycle>('cycles', state.activeCycleId);
  if (!cycle) return;
  normalizeCycle(cycle);
  const current = cycle.queue.shift() || cardId;
  const actual = current || cardId;
  cycle.history!.push({ cardId: actual, answer });
  if (answer === 'correct') cycle.correct += 1;
  else {
    cycle.wrong += 1;
    cycle.queue.push(actual);
  }
  recomputeWrongIds(cycle);
  if (cycle.queue.length === 0) cycle.done = true;
  await putOne('cycles', cycle);
  await refresh();
  if (cycle.done) {
    alert(T.done);
    state.view = 'cycles';
    state.selectedCardId = null;
    state.activeCycleId = null;
    state.pendingAnswer = null;
    state.revealed = false;
    render();
    return;
  }
  startSolving(cycle.queue[0], cycle.id);
}

function renderBooks(): void {
  const wbList = workbooksCache.map(wb => {
    const count = wb.cardIds.length;
    const active = state.selectedWorkbookId === wb.id ? 'active' : '';
    return `<button class="book-tile ${active}" data-wb="${esc(wb.id)}"><strong>${esc(wb.name)}</strong><span>${count} ${T.cards}</span></button>`;
  }).join('');
  const selected = workbookById(state.selectedWorkbookId) ?? workbooksCache[0];
  if (!state.selectedWorkbookId && selected) state.selectedWorkbookId = selected.id;
  const cardTiles = selectedWorkbookCards().map(c => `
    <button class="card-tile" data-card="${esc(c.id)}">
      <strong>#${c.number}</strong>
      <span class="small">${c.lastResult === 'wrong' ? '오답' : c.lastResult === 'correct' ? '정답' : '미풀이'}</span>
    </button>
  `).join('');
  const content = `
    <section class="section-head">
      <div>
        <h2>${T.books}</h2>
        <p class="small">PDF를 넣고 문항 카드를 확인합니다.</p>
      </div>
      <label class="primary-file"><input type="file" accept="application/pdf,.pdf" id="pdfInput" ${state.parsing ? 'disabled' : ''}>${T.importPdf}</label>
    </section>
    ${state.parsing || state.parseLog ? `
      <section class="card">
        <div class="progress-wrap"><div class="progress-bar" style="width:${Math.round(state.parseProgress * 100)}%"></div></div>
        <div style="margin-top:10px" class="logbox">${esc(state.parseLog)}</div>
      </section>
    ` : ''}
    <section class="card">
      <div class="row tight"><h3>내 문제집</h3><button class="secondary compact" id="resetBtn">${T.reset}</button></div>
      ${workbooksCache.length ? `<div class="book-grid">${wbList}</div>` : `<p>${T.noBooks}</p>`}
    </section>
    ${selected ? `
      <section class="card">
        <div class="row tight"><h3>${esc(selected.name)}</h3><span class="badge">${selected.cardIds.length} ${T.cards}</span></div>
        <div class="grid cards-grid">${cardTiles || `<p>${T.noBooks}</p>`}</div>
      </section>
    ` : ''}
  `;
  renderShell(content, T.books);
  document.querySelector('#pdfInput')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await handlePdfImport(file);
  });
  document.querySelector('#resetBtn')?.addEventListener('click', async () => {
    if (confirm('모든 문제집과 사이클을 삭제할까요?')) {
      await clearDB();
      state.selectedWorkbookId = null;
      state.selectedCardId = null;
      state.activeCycleId = null;
      state.selectedCycleId = null;
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
        <button id="solveCard">${T.solve}</button>
        <label class="buttonlike"><input type="file" accept="image/*" id="replaceQ" class="hidden"><button class="secondary" id="replaceQBtn" type="button">${T.replaceQ}</button></label>
        <label class="buttonlike"><input type="file" accept="image/*" id="replaceS" class="hidden"><button class="secondary" id="replaceSBtn" type="button">${T.replaceS}</button></label>
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

function cycleProgress(cycle: Cycle): { done: number; total: number; pct: number } {
  normalizeCycle(cycle);
  const total = Math.max(1, cycle.totalStart || cycle.queue.length || 1);
  const done = Math.min(total, cycle.correct || 0);
  return { done, total, pct: Math.round((done / total) * 100) };
}

function renderCycles(): void {
  const cycleList = cyclesCache.map(raw => {
    const cyc = normalizeCycle(raw);
    const p = cycleProgress(cyc);
    const orderLabel = cyc.order === 'rand' ? T.random : T.sequential;
    const sub = `${cyc.workbookNames?.length || 0}개 문제집 · ${orderLabel}`;
    return `
      <article class="cycle-card">
        <div class="cycle-head">
          <div><h3>${esc(cyc.name)}</h3><p>${esc(sub)}</p></div>
          <span class="progress-text">${p.done}/${p.total} (${p.pct}%)</span>
        </div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${p.pct}%"></div></div>
        <div class="cycle-actions">
          <button data-cycle="${esc(cyc.id)}" ${cyc.done ? 'disabled' : ''}>${T.continue}</button>
          <button class="secondary" data-wrong-cycle="${esc(cyc.id)}">${T.wrongCards}</button>
          <button class="secondary danger-lite" data-delete-cycle="${esc(cyc.id)}">${T.delete}</button>
        </div>
      </article>
    `;
  }).join('');
  const content = `
    <section class="section-head">
      <div>
        <h2>내 학습 사이클</h2>
        <p class="small">진행도와 오답 문항을 따로 관리합니다.</p>
      </div>
      <button id="openCycleCreate">+ ${T.newCycle}</button>
    </section>
    <section>${cycleList || `<div class="card"><p class="small">아직 저장된 사이클이 없습니다.</p></div>`}</section>
  `;
  renderShell(content, T.cycles);
  document.querySelector('#openCycleCreate')?.addEventListener('click', showCycleCreateSheet);
  document.querySelectorAll<HTMLElement>('[data-cycle]').forEach(el => {
    el.addEventListener('click', () => continueCycle(el.dataset.cycle || ''));
  });
  document.querySelectorAll<HTMLElement>('[data-wrong-cycle]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedCycleId = el.dataset.wrongCycle || null;
      state.view = 'wrongList';
      render();
    });
  });
  document.querySelectorAll<HTMLElement>('[data-delete-cycle]').forEach(el => {
    el.addEventListener('click', async () => {
      if (confirm('이 학습 사이클을 삭제할까요?')) {
        await deleteOne('cycles', el.dataset.deleteCycle || '');
        await refresh();
        render();
      }
    });
  });
}

function showCycleCreateSheet(): void {
  if (document.querySelector('#cycleCreateSheet')) return;
  if (!workbooksCache.length) {
    alert(T.noBooks);
    return;
  }
  const workbookOptions = workbooksCache.map(wb => `
    <label class="check-row"><input type="checkbox" name="cycleWb" value="${esc(wb.id)}"> <span>${esc(wb.name)} <span class="small">(${wb.cardIds.length})</span></span></label>
  `).join('');
  const sheet = document.createElement('div');
  sheet.className = 'modal-backdrop';
  sheet.id = 'cycleCreateSheet';
  sheet.innerHTML = `
    <div class="modal">
      <h2>${T.newCycle}</h2>
      <label>${T.cycleName}<input id="cycleName" type="text" placeholder="예: 미적분 랜덤 1회독"></label>
      <div class="checkbox-list" style="margin-top:12px">${workbookOptions}</div>
      <div class="row" style="margin-top:12px">
        <label>${T.order}<select id="cycleOrder"><option value="seq">${T.sequential}</option><option value="rand">${T.random}</option></select></label>
        <label>${T.problemCount}<input id="cycleLimit" type="number" min="0" placeholder="전체"></label>
      </div>
      <p class="small" id="cycleCountPreview" style="margin-top:10px">선택된 문항 0개</p>
      <div class="row" style="margin-top:12px">
        <button id="startCycle">${T.start}</button>
        <button class="secondary" id="closeCycleCreate">취소</button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  const updatePreview = () => {
    const wbIds = Array.from(sheet.querySelectorAll<HTMLInputElement>('input[name="cycleWb"]:checked')).map(x => x.value);
    const sourceIds = new Set<string>();
    for (const wbId of wbIds) workbookById(wbId)?.cardIds.forEach(id => sourceIds.add(id));
    const preview = sheet.querySelector('#cycleCountPreview');
    if (preview) preview.textContent = `선택된 문항 ${sourceIds.size}개`;
  };
  sheet.querySelectorAll('input[name="cycleWb"]').forEach(x => x.addEventListener('change', updatePreview));
  sheet.querySelector('#closeCycleCreate')?.addEventListener('click', () => sheet.remove());
  sheet.querySelector('#startCycle')?.addEventListener('click', async () => {
    await startNewCycleFromSheet(sheet);
  });
}

async function startNewCycleFromSheet(sheet: HTMLElement): Promise<void> {
  const wbIds = Array.from(sheet.querySelectorAll<HTMLInputElement>('input[name="cycleWb"]:checked')).map(x => x.value);
  if (!wbIds.length) {
    alert(T.selectBook);
    return;
  }
  const order = (sheet.querySelector('#cycleOrder') as HTMLSelectElement).value as 'seq' | 'rand';
  const limit = Math.max(0, Number((sheet.querySelector('#cycleLimit') as HTMLInputElement).value || 0));
  const workbookNames = wbIds.map(id => workbookById(id)?.name || '').filter(Boolean);
  const sourceIds = new Set<string>();
  for (const wbId of wbIds) workbookById(wbId)?.cardIds.forEach(id => sourceIds.add(id));
  let ids = cardsCache.filter(c => sourceIds.has(c.id)).sort((a, b) => a.number - b.number).map(c => c.id);
  if (order === 'rand') ids = shuffle(ids);
  if (limit > 0) ids = ids.slice(0, limit);
  if (!ids.length) {
    alert('선택된 문항이 없습니다.');
    return;
  }
  const nameRaw = (sheet.querySelector('#cycleName') as HTMLInputElement).value.trim();
  const cycle: Cycle = {
    id: uid('cycle'),
    name: nameRaw || '미적',
    createdAt: Date.now(),
    queue: ids,
    totalStart: ids.length,
    correct: 0,
    wrong: 0,
    done: false,
    order,
    workbookNames,
    wrongIds: [],
    history: []
  };
  await putOne('cycles', cycle);
  sheet.remove();
  await refresh();
  render();
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
  if (!cycle) return;
  normalizeCycle(cycle);
  if (cycle.done || cycle.queue.length === 0) return;
  await putOne('cycles', cycle);
  startSolving(cycle.queue[0], cycle.id);
}

function startSolving(cardId: string, cycleId: string | null): void {
  state.view = 'solve';
  state.selectedCardId = cardId;
  state.activeCycleId = cycleId;
  state.selectedCycleId = cycleId;
  state.revealed = false;
  state.pendingAnswer = cycleId ? null : (cardById(cardId)?.lastResult || null);
  state.elapsedMs = 0;
  state.timerStart = performance.now();
  render();
}

function renderWrongList(): void {
  const cycle = cycleById(state.selectedCycleId);
  if (!cycle) {
    state.view = 'cycles';
    render();
    return;
  }
  normalizeCycle(cycle);
  const wrongIds = cycle.wrongIds || [];
  const tiles = wrongIds.map(id => {
    const c = cardById(id);
    if (!c) return '';
    return `<button class="card-tile" data-card="${esc(c.id)}"><strong>#${c.number}</strong><span class="small">오답 문항</span></button>`;
  }).join('');
  const content = `
    <section class="card">
      <div class="row tight"><h2>${esc(cycle.name)} ${T.wrongCards}</h2><span class="badge">${wrongIds.length}</span></div>
      <p class="small">이 사이클에서 한 번이라도 틀린 문항입니다.</p>
    </section>
    <section class="card"><div class="grid cards-grid">${tiles || `<p class="small">아직 오답 문항이 없습니다.</p>`}</div></section>
  `;
  renderShell(content, T.wrongCards, 'none');
  document.querySelector('#topBackBtn')?.addEventListener('click', () => void handleBackIntent());
  document.querySelectorAll<HTMLElement>('[data-card]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.card || null;
      const c = cardById(id);
      if (c) state.selectedWorkbookId = c.workbookId;
      state.selectedCardId = id;
      state.view = 'card';
      render();
    });
  });
}

function renderSolve(): void {
  const card = cardById(state.selectedCardId);
  if (!card) {
    state.view = state.activeCycleId ? 'cycles' : 'books';
    render();
    return;
  }
  const cycle = cycleById(state.activeCycleId);
  const p = cycle ? cycleProgress(normalizeCycle(cycle)) : null;
  const subtitle = cycle ? `${cycle.name} · ${p?.done}/${p?.total}` : `#${card.number}`;
  const status = state.pendingAnswer || card.lastResult || null;
  const content = `
    <section class="solve-toolbar">
      <div class="row tight">
        <span class="badge">#${card.number}</span>
        <span class="badge" id="timerBadge">${T.elapsed} ${msToText(state.revealed ? state.elapsedMs : performance.now() - state.timerStart)}</span>
        ${status ? `<span class="badge result-badge ${status}">${status === 'correct' ? '정답' : '오답'}</span>` : `<span class="badge">미선택</span>`}
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
    <section class="card drawing-card">
      <h3>${T.drawing}</h3>
      <div class="canvas-wrap"><canvas id="drawCanvas"></canvas></div>
      <button class="secondary" style="margin-top:10px" id="clearDrawing">${T.clearDrawing}</button>
    </section>
    ${state.revealed ? `
      <section class="card">
        <div class="result-buttons">
          <button class="ok ${status === 'correct' ? 'selected' : ''}" id="markCorrect">${T.correct}</button>
          <button class="danger ${status === 'wrong' ? 'selected' : ''}" id="markWrong">${T.wrong}</button>
        </div>
        <p class="small">버튼은 상태만 바꿉니다. 다음 문항은 아래 ${T.nextProblem} 버튼으로 이동합니다.</p>
      </section>
    ` : ``}
  `;
  renderShell(content, subtitle);
  setupDrawingCanvas(card);
  document.querySelector('#clearDrawing')?.addEventListener('click', () => clearCanvas());
  if (!state.revealed) {
    const interval = window.setInterval(() => {
      if (state.view !== 'solve' || state.revealed) {
        window.clearInterval(interval);
        return;
      }
      const badge = document.querySelector('#timerBadge');
      if (badge) badge.textContent = `${T.elapsed} ${msToText(performance.now() - state.timerStart)}`;
    }, 500);
  } else {
    document.querySelector('#markCorrect')?.addEventListener('click', () => void markResult('correct'));
    document.querySelector('#markWrong')?.addEventListener('click', () => void markResult('wrong'));
  }
}

function render(): void {
  if (state.view === 'books') renderBooks();
  else if (state.view === 'cycles') renderCycles();
  else if (state.view === 'card') renderCardDetail();
  else if (state.view === 'wrongList') renderWrongList();
  else renderSolve();
}

async function goBackInApp(): Promise<boolean> {
  const modal = document.querySelector('.modal-backdrop');
  if (modal) {
    modal.remove();
    return true;
  }
  if (state.view === 'solve') {
    await saveVisibleSolveFeedback();
    state.view = state.activeCycleId ? 'cycles' : 'card';
    state.activeCycleId = null;
    state.pendingAnswer = null;
    state.revealed = false;
    render();
    return true;
  }
  if (state.view === 'card') {
    state.view = 'books';
    state.selectedCardId = null;
    render();
    return true;
  }
  if (state.view === 'wrongList') {
    state.view = 'cycles';
    state.selectedCycleId = null;
    render();
    return true;
  }
  return false;
}

async function handleBackIntent(): Promise<void> {
  const handled = await goBackInApp();
  if (handled) return;
  if (confirm(T.exitAsk)) {
    try { await CapacitorApp.exitApp(); }
    catch { /* web preview: do nothing */ }
  }
}

function registerBackHandlers(): void {
  try {
    CapacitorApp.addListener('backButton', () => { void handleBackIntent(); });
  } catch { /* not running inside Capacitor */ }
  try {
    history.replaceState({ mathCycle: true }, '', location.href);
    history.pushState({ mathCycle: true }, '', location.href);
    window.addEventListener('popstate', () => {
      void handleBackIntent();
      history.pushState({ mathCycle: true }, '', location.href);
    });
  } catch { /* ignore */ }
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
type AnchorStyle = 'question-dot' | 'corner' | 'paren' | 'square' | 'prefix-empty';

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

const GUIDE_NUMBERED_HEAD_RE = /^(?:구성|사용법|편입수학|핵심\s*공부법|공부법|학습법|활용법|목차|차례|안내|주의|설명|준비|구조|교재|강의|수업|복습|진도|part\b|파트\b|section\b|chapter\b)/i;
const GUIDE_CONTEXT_RE = /수업시간|초집중|당일복습|누적복습|진도|part\s*\d*|파트\s*\d*|셀프연습|유형별문제|유형별\s*문제|확인용|점검용|반복|공부법|사용법|구성|설명|안내|목차|차례|교재|강의|수업|응시|숙지/i;
const QUESTION_CONTEXT_RE = /값은|값을|구하|고르|옳은|옳지|틀린|다음\s*중|모두|만족|해를|근을|기울기|접선|미분|도함수|극한|연속|불연속|정의역|치역|좌표|개수|넓이|함수|방정식|수열|곡선|실수|상수|계수|간단히|같은\s*것|가장|나머지|평균\s*변화율/i;
const MATH_CONTEXT_RE = /lim|sin|cos|tan|cot|sec|csc|ln|log|arc|sinh|cosh|tanh|sqrt|함수|방정식|극한|미분|도함수|곡선|수열|접선|[=+\-×÷≤≥<>→∞π∫]|[\uE000-\uF8FF]/i;
const CHOICE_MARK_RE = /[①②③④⑤⑥⑦⑧⑨ⓐⓑⓒⓓⓔⓕ➀➁➂➃➄]/g;
const INLINE_ANSWER_MARK_RE = /(?:【\s*\d{1,4}\s*】|\d{1,4}\s*【\s*】)/;

function nearbyBlockText(page: PageInfo, line: LineLite, yWindow = 170, maxLines = 9): string {
  return normalizeText(page.lines
    .filter(l => l.col === line.col && l.y >= line.y - 2 && l.y <= line.y + yWindow && !isDecorativeLine(l.text))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, maxLines)
    .map(l => l.text)
    .join(' '));
}

function numberedLineBody(text: string): string {
  return normalizeText(text.replace(/^\d{1,4}\s*\.\s*/, ''));
}

function questionEvidenceScore(page: PageInfo, line: LineLite): number {
  const text = normalizeText(line.text);
  const body = numberedLineBody(text);
  const block = nearbyBlockText(page, line);
  const choices = block.match(CHOICE_MARK_RE)?.length ?? 0;
  let evidence = 0;

  if (GUIDE_NUMBERED_HEAD_RE.test(body)) evidence -= 110;
  if (GUIDE_CONTEXT_RE.test(block) && choices === 0 && !INLINE_ANSWER_MARK_RE.test(block)) evidence -= 45;
  if (/^\d{1,4}\s*\.\s*[가-힣a-zA-Z\s]{1,24}[:：]?$/.test(text) && !QUESTION_CONTEXT_RE.test(block)) evidence -= 34;

  if (INLINE_ANSWER_MARK_RE.test(block)) evidence += 34;
  if (QUESTION_CONTEXT_RE.test(block)) evidence += 30;
  if (MATH_CONTEXT_RE.test(block)) evidence += 18;
  if (choices >= 2) evidence += Math.min(34, choices * 7);
  if (/\?/.test(block)) evidence += 14;
  if (/\[[가-힣A-Za-z]{1,10}\d{0,2}\]/.test(block)) evidence += 6;

  return evidence;
}

function detectQuestionAnchor(page: PageInfo, line: LineLite): Anchor | null {
  const text = normalizeText(line.text);
  const m = text.match(/^(\d{1,4})\s*\.\s*(?=\S|$)/);
  if (!m) return null;
  const number = Number(m[1]);
  if (!Number.isFinite(number) || number < 1 || number > 9999) return null;
  const body = numberedLineBody(text);
  if (GUIDE_NUMBERED_HEAD_RE.test(body)) return null;
  const b = colBounds(page, line.col);
  const colWidth = Math.max(1, b.x2 - b.x1);
  const indentRatio = Math.max(0, line.x - b.x1) / colWidth;
  if (indentRatio > 0.42) return null;
  const evidence = questionEvidenceScore(page, line);
  if (evidence < 16) return null;
  let score = 70 + scoreLeftIndent(page, line) + evidence;
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
    { style: 'prefix-empty', re: /^(\d{1,4})\s*【\s*】\s*(?:정답|답|sol|풀이|해설)?/i, weight: 68 },
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

function detectSolutionAnchors(page: PageInfo): Anchor[] {
  const anchors: Anchor[] = [];
  for (const line of page.lines) {
    const a = detectSolutionAnchor(page, line);
    if (a) anchors.push(a);
  }

  // Some answer PDFs encode the marker as a tiny standalone text item inside a longer visual line.
  // Add item-level anchors so short solutions like "【5】 ... 【6】 ..." do not get merged incorrectly.
  for (const item of page.items) {
    const text = normalizeText(item.str);
    const m = text.match(/^【\s*(\d{1,4})\s*】$/);
    if (!m) continue;
    const number = Number(m[1]);
    if (!Number.isFinite(number) || number < 1 || number > 9999) continue;
    const line = page.lines
      .filter(l => l.col === item.col && Math.abs((l.y + l.h / 2) - (item.y + item.h / 2)) <= Math.max(5, item.h))
      .sort((a, b) => Math.abs(a.x - item.x) - Math.abs(b.x - item.x))[0];
    const fakeLine: LineLite = line || {
      pageNum: page.pageNum,
      cellIndex: (page.pageNum - 1) * 2 + item.col,
      col: item.col,
      text,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      items: [item]
    };
    const gap = gapAbove(fakeLine, page.lines);
    let score = 70 + scoreLeftIndent(page, fakeLine);
    if (/정답|답\s*[:;]|sol\)?|풀이|해설/i.test(fakeLine.text)) score += 28;
    if (gap > 16) score += 10;
    anchors.push({
      type: 'solution',
      style: 'corner',
      number,
      pageNum: page.pageNum,
      cellIndex: (page.pageNum - 1) * 2 + item.col,
      col: item.col,
      x: item.x,
      y: item.y,
      h: item.h,
      lineText: fakeLine.text,
      score
    });
  }

  const deduped: Anchor[] = [];
  for (const a of anchors.sort((x, y) => anchorSort(x, y) || y.score - x.score)) {
    const duplicate = deduped.some(b => b.number === a.number && b.pageNum === a.pageNum && b.col === a.col && Math.abs(b.y - a.y) < 8 && Math.abs(b.x - a.x) < 80);
    if (!duplicate) deduped.push(a);
  }
  return deduped.sort(anchorSort);
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
  const styles: AnchorStyle[] = ['corner', 'prefix-empty', 'paren', 'square'];
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
      pageInfo.solutionCandidates = detectSolutionAnchors(pageInfo);
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
  registerBackHandlers();
  await refresh();
  render();
})();

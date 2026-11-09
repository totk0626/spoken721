'use strict';

const WORDS = window.WORDS || [];
const BY_ID = new Map(WORDS.map(w => [w.id, w]));
const TOTAL = WORDS.length;

const POS_KO = {
  noun: '명사', verb: '동사', adjective: '형용사', adverb: '부사', pronoun: '대명사',
  preposition: '전치사', conjunction: '접속사', determiner: '한정사', article: '관사',
  modal: '조동사', interjection: '감탄사', number: '수사',
};
const STATUS = { new: '새 단어', learning: '학습 중', mastered: '외운 단어' };
const FILTERS = [{ id: 'all', label: '전체' }, ...Object.entries(STATUS).map(([id, label]) => ({ id, label }))];
const INTERVAL = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };
const MAX_BOX = 5;
const MASTERED_BOX = 4;
const VERDICT_BOX = { cold: 3, know: 2, unsure: 1 };
const GOAL_MIN = 5;
const GOAL_MAX = 100;
const GOAL_STEP = 5;
const GOAL_PRESETS = [10, 20, 30, 50, 100];
const DEFAULT_GOAL = 10;
const WEEK_TARGET = 5;
const QUIZ_SIZE = 10;
const QUIZ_OPTIONS = 4;
const MIN_QUIZ_WORDS = 4;
const ORDER_SEED = 721;
const STORAGE_KEY = 'spoken721.v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS_FROM_MON = ['월', '화', '수', '목', '금', '토', '일'];
const WEEKDAYS_FROM_SUN = ['일', '월', '화', '수', '목', '금', '토'];

/* ---------- dates (local time, keyed "YYYY-MM-DD") ---------- */

const pad2 = n => String(n).padStart(2, '0');
const dayKey = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const todayKey = () => dayKey(new Date());

function keyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const date = keyDate(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

function weekKeys(today) {
  const monday = addDays(today, -((keyDate(today).getDay() + 6) % 7));
  return WEEKDAYS_FROM_MON.map((_, i) => addDays(monday, i));
}

const formatShortDate = key => `${Number(key.slice(5, 7))}월 ${Number(key.slice(8))}일`;
const formatLongDate = date => `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS_FROM_SUN[date.getDay()]}요일`;

/* ---------- words ---------- */

const headline = word => word.pos[0].senses[0].ko;
const searchText = word => [word.w, ...word.pos.flatMap(g => g.senses.map(s => s.ko))].join('\n').toLowerCase();

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const NEW_ORDER = shuffle(WORDS.map(w => w.id), mulberry32(ORDER_SEED));

/* ---------- progress: persisted state and its pure transitions ---------- */

function initialState() {
  return { v: 1, goal: DEFAULT_GOAL, onboarded: false, swiped: false, cards: {}, log: {} };
}

function bumpLog(log, today, field) {
  const day = log[today] || { learned: 0, quizzed: 0 };
  return { ...log, [today]: { ...day, [field]: day[field] + 1 } };
}

const schedule = (card, box, today) => ({ ...card, box, due: addDays(today, INTERVAL[box]) });

function learnWord(state, id, verdict, today) {
  const prev = state.cards[id];
  const card = schedule(prev || { box: 1, due: today, seen: today, right: 0, wrong: 0 }, VERDICT_BOX[verdict], today);
  return {
    ...state,
    cards: { ...state.cards, [id]: card },
    log: prev ? state.log : bumpLog(state.log, today, 'learned'),
  };
}

function answerQuiz(state, id, correct, today) {
  const card = state.cards[id];
  const next = {
    ...schedule(card, correct ? Math.min(MAX_BOX, card.box + 1) : 1, today),
    right: card.right + (correct ? 1 : 0),
    wrong: card.wrong + (correct ? 0 : 1),
  };
  return { ...state, cards: { ...state.cards, [id]: next }, log: bumpLog(state.log, today, 'quizzed') };
}

const clampGoal = n => Math.min(GOAL_MAX, Math.max(GOAL_MIN, Math.round(n / GOAL_STEP) * GOAL_STEP));
const stepGoal = (goal, direction) => clampGoal(goal + direction * GOAL_STEP);
const setGoal = (state, goal) => ({ ...state, goal });
const finishOnboarding = (state, goal) => ({ ...state, goal, onboarded: true });
const markSwiped = state => ({ ...state, swiped: true });
const resetProgress = state => ({ ...initialState(), goal: state.goal, onboarded: true, swiped: state.swiped });

const statusOf = card => (!card ? 'new' : card.box >= MASTERED_BOX ? 'mastered' : 'learning');
const learnedIds = state => Object.keys(state.cards).map(Number);
const isDue = (card, today) => card.due <= today;
const dueIds = (state, today) => learnedIds(state).filter(id => isDue(state.cards[id], today));

function nextNewIds(state, n) {
  const ids = [];
  for (const id of NEW_ORDER) {
    if (ids.length >= n) break;
    if (!state.cards[id]) ids.push(id);
  }
  return ids;
}

function isActive(log, key) {
  const day = log[key];
  return Boolean(day) && day.learned + day.quizzed > 0;
}

function streak(log, today) {
  let key = isActive(log, today) ? today : addDays(today, -1);
  let days = 0;
  while (isActive(log, key)) {
    days += 1;
    key = addDays(key, -1);
  }
  return days;
}

function overview(state, today) {
  const ids = learnedIds(state);
  const todayLearned = (state.log[today] || { learned: 0 }).learned;
  const remaining = state.goal - todayLearned;
  const newLeft = TOTAL - ids.length;
  const week = weekKeys(today).map(key => ({
    key,
    learned: (state.log[key] || { learned: 0 }).learned,
    active: isActive(state.log, key),
    today: key === today,
  }));
  return {
    goal: state.goal,
    todayLearned,
    goalMet: remaining <= 0,
    sessionSize: Math.min(remaining > 0 ? remaining : state.goal, newLeft),
    newLeft,
    learned: ids.length,
    mastered: ids.filter(id => state.cards[id].box >= MASTERED_BOX).length,
    due: ids.filter(id => isDue(state.cards[id], today)).length,
    streak: streak(state.log, today),
    activeToday: isActive(state.log, today),
    week,
    activeDays: week.filter(d => d.active).length,
  };
}

/* ---------- quiz questions ---------- */

const QUESTION_TYPES = {
  meaning: { label: '알맞은 뜻을 고르세요', answer: headline, optionLang: 'ko', prompt: word => wordPrompt(word) },
  word: { label: '이 영영 정의에 맞는 단어는?', answer: word => word.w, optionLang: 'en', prompt: word => defPrompt(word), gloss: headline },
};
const QUESTION_ROTATION = ['meaning', 'word'];

function makeQuestion(word, type, rng) {
  const answerOf = QUESTION_TYPES[type].answer;
  const answer = answerOf(word);
  const options = [answer];
  for (const other of shuffle(WORDS, rng)) {
    if (options.length === QUIZ_OPTIONS) break;
    const text = answerOf(other);
    if (!options.includes(text)) options.push(text);
  }
  return { id: word.id, type, answer, options: shuffle(options, rng) };
}

function buildQuiz(state, today, rng) {
  const ids = learnedIds(state);
  if (ids.length < MIN_QUIZ_WORDS) return [];
  const due = ids.filter(id => isDue(state.cards[id], today));
  const rest = ids.filter(id => !isDue(state.cards[id], today));
  const picked = shuffle([...shuffle(due, rng), ...shuffle(rest, rng)].slice(0, QUIZ_SIZE), rng);
  return picked.map((id, i) => makeQuestion(BY_ID.get(id), QUESTION_ROTATION[i % QUESTION_ROTATION.length], rng));
}

/* ---------- sessions: learn and quiz flows as small reducers ---------- */

// The moves each card phase accepts: `to` turns the card over, `verdict` answers it and moves on.
const LEARN_MOVES = {
  front: { reveal: { to: 'back' }, know: { verdict: 'cold' }, unsure: { to: 'confirm' } },
  back: { know: { verdict: 'know' }, unsure: { verdict: 'unsure' } },
  confirm: { unsure: { verdict: 'unsure' } },
  done: {},
};

function learnStart(ids) {
  return { queue: ids.slice(), phase: ids.length ? 'front' : 'done', total: ids.length, results: {} };
}

function learnMove(state, s, move, today) {
  const step = LEARN_MOVES[s.phase][move];
  if (!step) return { state, session: s, answered: false };
  if (step.to) return { state, session: { ...s, phase: step.to }, answered: false };
  const [id, ...rest] = s.queue;
  // A word missed once this session stays due tomorrow, even when a later pass says 알아요.
  const verdict = s.results[id] === 'unsure' ? 'unsure' : step.verdict;
  const queue = step.verdict === 'unsure' ? [...rest, id] : rest;
  return {
    state: learnWord(state, id, verdict, today),
    session: { ...s, queue, phase: queue.length ? 'front' : 'done', results: { ...s.results, [id]: verdict } },
    answered: true,
  };
}

function learnTally(s) {
  return {
    total: s.total,
    known: s.total - s.queue.length,
    unsure: s.queue.filter(id => s.results[id] === 'unsure').length,
    reviewed: Object.values(s.results).filter(v => v === 'unsure').length,
  };
}

const quizStart = questions => ({ questions, i: 0, phase: 'ask', pick: null, score: 0, missed: [] });

function quizPick(s, option) {
  const q = s.questions[s.i];
  const correct = option === q.answer;
  return {
    ...s,
    phase: 'answered',
    pick: option,
    score: s.score + (correct ? 1 : 0),
    missed: correct ? s.missed : [...s.missed, q.id],
  };
}

function quizNext(s) {
  const i = s.i + 1;
  return i < s.questions.length ? { ...s, i, phase: 'ask', pick: null } : { ...s, phase: 'done' };
}

/* ---------- storage boundary ---------- */

const validCard = c => Boolean(c) && Number.isInteger(c.box) && c.box >= 1 && c.box <= MAX_BOX
  && DATE_RE.test(c.due) && DATE_RE.test(c.seen) && Number.isFinite(c.right) && Number.isFinite(c.wrong);
const validDay = d => Boolean(d) && Number.isFinite(d.learned) && Number.isFinite(d.quizzed);

function parseState(raw) {
  const base = initialState();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!data || data.v !== 1) return base;
  const cards = {};
  for (const [id, card] of Object.entries(data.cards || {})) {
    if (BY_ID.has(Number(id)) && validCard(card)) cards[id] = card;
  }
  const log = {};
  for (const [key, day] of Object.entries(data.log || {})) {
    if (DATE_RE.test(key) && validDay(day)) log[key] = { learned: day.learned, quizzed: day.quizzed };
  }
  return {
    v: 1,
    goal: Number.isFinite(data.goal) ? clampGoal(data.goal) : base.goal,
    onboarded: data.onboarded === true,
    swiped: data.swiped === true,
    cards,
    log,
  };
}

function loadState() {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return initialState();
  }
}

function saveState(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the session keeps working from memory.
  }
}

window.Spoken = {
  dayKey, addDays, weekKeys, mulberry32, shuffle, NEW_ORDER, headline,
  initialState, parseState, clampGoal, stepGoal, learnWord, answerQuiz, setGoal, finishOnboarding, markSwiped, resetProgress,
  statusOf, nextNewIds, dueIds, streak, overview, buildQuiz,
  learnStart, learnMove, learnTally, quizStart, quizPick, quizNext,
};

/* ---------- app shell state ---------- */

let state = initialState();
let dom = null;

function commit(next) {
  state = next;
  saveState(state);
}

/* ---------- motion ---------- */

const EASE_SCREEN = 'cubic-bezier(.32,.72,0,1)';
const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const STAGGER_MS = 45;
const WORD_STAGGER_MS = 40;
const BAR_DELAY_MS = 160;
const ENTER_MS = 560;
const COUNT_MS = 1100;
const SPLASH_MS = 2100;
const SWIPE = { start: 8, commit: 96, flick: 0.5, tilt: 0.05, maxTilt: 12, sampleMs: 100, flyMs: 280, backMs: 260 };

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function animate(el, frames, duration, { easing = EASE_SCREEN, fill = 'none' } = {}) {
  if (prefersReducedMotion() || !el.animate) return Promise.resolve();
  return el.animate(frames, { duration, easing, fill }).finished.catch(() => {});
}

function playEntrance(root) {
  if (prefersReducedMotion()) return;
  let delay = 0;
  let end = 0;
  root.querySelectorAll('[data-enter], [data-title]').forEach((el, i) => {
    delay = i * STAGGER_MS;
    const parts = el.hasAttribute('data-title') ? Array.from(el.querySelectorAll('.tw')) : [el];
    parts.forEach((part, j) => {
      const at = delay + j * WORD_STAGGER_MS;
      part.style.animationDelay = `${at}ms`;
      end = Math.max(end, at);
    });
  });
  root.querySelectorAll('[data-bar]').forEach(el => {
    el.style.animationDelay = `${delay + BAR_DELAY_MS}ms`;
    end = Math.max(end, delay + BAR_DELAY_MS);
  });
  root.classList.add('entering');
  // Entrance keyframes fill "both", which would pin transform and block the :active press scale.
  setTimeout(() => root.classList.remove('entering'), end + ENTER_MS + 60);
}

function countUp(el, to) {
  if (prefersReducedMotion() || to === 0) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  el.textContent = '0';
  const tick = now => {
    const t = Math.min(1, (now - start) / COUNT_MS);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const FILLS = {
  x: (el, v) => { el.style.transform = `scaleX(${v})`; },
  y: (el, v) => { el.style.transform = `scaleY(${v})`; },
  ring: (el, v) => { el.style.strokeDashoffset = String(Number(el.dataset.len) * (1 - v)); },
};

function playMounted(root) {
  root.querySelectorAll('[data-count]').forEach(el => countUp(el, Number(el.dataset.count)));
  // Two frames so the empty state paints first and the CSS transition has a start value.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('[data-fill]').forEach(el => FILLS[el.dataset.kind](el, Number(el.dataset.fill)));
  }));
}

function releaseVelocity(samples, now) {
  const recent = samples.filter(s => now - s.t <= SWIPE.sampleMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return (last.x - first.x) / Math.max(1, last.t - first.t);
}

// The card only claims a gesture once it is clearly horizontal; touch-action: pan-y leaves vertical drags to the scroller.
function swipeCard(card, stamps, { canStart, onCommit }) {
  let drag = null;
  let swallowClick = false;
  const tilt = dx => (prefersReducedMotion() ? 0 : clamp(dx * SWIPE.tilt, -SWIPE.maxTilt, SWIPE.maxTilt));

  function place(dx) {
    card.style.transform = `translateX(${dx}px) rotate(${tilt(dx)}deg)`;
    stamps.know.style.opacity = String(clamp(dx / SWIPE.commit, 0, 1));
    stamps.unsure.style.opacity = String(clamp(-dx / SWIPE.commit, 0, 1));
  }

  function springBack() {
    const from = card.style.transform || 'none';
    card.style.transform = '';
    animate(card, [{ transform: from }, { transform: 'none' }], SWIPE.backMs);
    for (const stamp of [stamps.know, stamps.unsure]) {
      const shown = Number(stamp.style.opacity || 0);
      stamp.style.opacity = '';
      if (shown) animate(stamp, [{ opacity: shown }, { opacity: 0 }], SWIPE.backMs);
    }
  }

  function release(e, completed) {
    if (!drag || e.pointerId !== drag.id) return;
    const { live, dx, samples } = drag;
    drag = null;
    if (!live) return;
    card.classList.remove('is-dragging');
    swallowClick = true;
    const dir = Math.sign(dx);
    const flung = completed && dir !== 0
      && (Math.abs(dx) > SWIPE.commit || releaseVelocity([...samples, { x: e.clientX, t: e.timeStamp }], e.timeStamp) * dir > SWIPE.flick);
    if (!flung || !onCommit(dir)) springBack();
  }

  card.addEventListener('pointerdown', e => {
    swallowClick = false;
    if (drag || !e.isPrimary || e.button !== 0 || !canStart()) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, live: false, samples: [{ x: e.clientX, t: e.timeStamp }] };
  });
  card.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.live) {
      if (Math.abs(dy) > SWIPE.start && Math.abs(dy) >= Math.abs(dx)) {
        drag = null;
        return;
      }
      if (Math.abs(dx) <= SWIPE.start || Math.abs(dx) <= Math.abs(dy)) return;
      drag.live = true;
      card.setPointerCapture(e.pointerId);
      card.getAnimations({ subtree: true }).forEach(a => a.cancel());
      card.classList.add('is-dragging');
    }
    drag.dx = dx;
    drag.samples = [...drag.samples.filter(s => e.timeStamp - s.t <= SWIPE.sampleMs), { x: e.clientX, t: e.timeStamp }];
    place(dx);
  });
  card.addEventListener('pointerup', e => release(e, true));
  card.addEventListener('pointercancel', e => release(e, false));
  // A drag that ends over a button inside the card must not also press it.
  card.addEventListener('click', e => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function flyOff(card, stamp, dir) {
  const x = dir * (card.parentNode.clientWidth + card.offsetHeight / 4);
  animate(stamp, [{ opacity: Number(stamp.style.opacity || 0) }, { opacity: 1 }], SWIPE.flyMs / 2, { fill: 'forwards' });
  return animate(card, [{ transform: card.style.transform || 'none' }, { transform: `translateX(${x}px) rotate(${dir * SWIPE.maxTilt}deg)` }],
    SWIPE.flyMs, { easing: EASE_OUT, fill: 'forwards' });
}

/* ---------- DOM building blocks ---------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...kids);
  return el;
}

const ICONS = {
  home: '<path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  book: '<path d="M3 5.5h5.5A3.5 3.5 0 0 1 12 9v11a2.6 2.6 0 0 0-2.6-2.6H3z"/><path d="M21 5.5h-5.5A3.5 3.5 0 0 0 12 9v11a2.6 2.6 0 0 1 2.6-2.6H21z"/>',
  sliders: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  speaker: '<path d="M11 5.5 6.5 9H3.5v6h3l4.5 3.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  flame: '<path d="M12 3.5c.8 3.2 5 5.2 5 9.8a5 5 0 0 1-10 0c0-2.3 1.2-3.8 2.3-4.8.3 1.5 1 2.4 1.9 2.8-.2-2.8.3-5.4.8-7.8z"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14-14-.3 9-5.8 14-14 14z"/><path d="M5 19 13 11"/>',
  repeat: '<path d="M19.5 11.5a7.5 7.5 0 1 0-2.2 5.3"/><path d="M19.5 5.5v6h-6"/>',
};

function icon(name) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

const ILLOS = {
  cards: '<svg viewBox="0 0 128 104"><g transform="rotate(-10 64 54)"><rect class="i-sub" x="32" y="14" width="64" height="80" rx="16"/></g><g transform="rotate(7 64 52)"><rect class="i-card" x="32" y="12" width="64" height="80" rx="16"/><rect class="i-acc" x="45" y="32" width="30" height="7" rx="3.5"/><rect class="i-line" x="45" y="48" width="38" height="5" rx="2.5"/><rect class="i-line" x="45" y="60" width="26" height="5" rx="2.5"/></g><circle class="i-acc" cx="108" cy="22" r="4"/><circle class="i-sub" cx="18" cy="80" r="6"/></svg>',
  check: '<svg viewBox="0 0 128 104"><circle class="i-sub" cx="64" cy="52" r="42"/><circle class="i-card" cx="64" cy="52" r="28"/><path class="i-stroke" d="m52 52.5 8 8 16-16"/><circle class="i-acc" cx="110" cy="20" r="4"/><circle class="i-acc" cx="16" cy="76" r="3"/><circle class="i-sub" cx="112" cy="86" r="6"/></svg>',
};

function illo(name) {
  const wrap = h('div', { class: 'illo', 'data-enter': '', 'aria-hidden': 'true' });
  const bob = h('div', { class: 'bob' });
  bob.innerHTML = ILLOS[name];
  wrap.append(bob);
  return wrap;
}

function splitWords(text) {
  return text.split('\n').map((line, li) => [
    li ? h('br') : null,
    line.split(' ').map((word, wi) => [wi ? ' ' : null, h('span', { class: 'tw' }, word)]),
  ]);
}

const title = (text, cls = 'title') => h('h1', { class: cls, 'data-title': '' }, splitWords(text));
const btn = (label, kind, onclick, extra = {}) => h('button', { class: `btn btn-${kind}`, type: 'button', onclick, ...extra }, label);
const iconButton = (name, label, onclick, variant = 'glass') =>
  h('button', { class: `icon-btn icon-btn-${variant}`, type: 'button', 'aria-label': label, onclick }, icon(name));
const count = (n, cls) => h('b', { class: cls, 'data-count': n }, String(n));

function meter(value) {
  return h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { 'data-fill': value, 'data-kind': 'x' }));
}

function ring(value, size, stroke, center) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const c = size / 2;
  const bar = value > 0
    ? svg('circle', { class: 'ring-bar', cx: c, cy: c, r, 'stroke-width': stroke, 'stroke-dasharray': len, 'stroke-dashoffset': len, 'data-fill': value, 'data-kind': 'ring', 'data-len': len })
    : '';
  return h('div', { class: 'ring', style: `width:${size}px;height:${size}px` },
    svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
      svg('circle', { class: 'ring-track', cx: c, cy: c, r, 'stroke-width': stroke }),
      bar),
    h('div', { class: 'ring-center' }, center));
}

/* ---------- pronunciation ---------- */

const canSpeak = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function speak(text) {
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  const voice = window.speechSynthesis.getVoices().find(v => /^en[-_]US$/i.test(v.lang));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

const speakerButton = (text, variant = 'soft') =>
  (canSpeak() ? iconButton('speaker', '발음 듣기', () => speak(text), variant) : null);

/* ---------- word presentation ---------- */

const LONG_WORD = 9;

function wordHead(word) {
  return h('div', { class: 'word-head' },
    h('div', { class: 'word-line' },
      h('h2', { class: `word-title${word.w.length > LONG_WORD ? ' is-long' : ''}`, lang: 'en' }, word.w),
      speakerButton(word.w)),
    h('p', { class: 'def-label' }, '원문 영영 정의'),
    h('p', { class: 'def', lang: 'en' }, word.def));
}

function emphasize(sentence, w) {
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}${w.length > 3 ? '\\w*' : '\\b'}`, 'i').exec(sentence);
  if (!match) return sentence;
  return [sentence.slice(0, match.index), h('b', {}, match[0]), sentence.slice(match.index + match[0].length)];
}

function wordDetail(word) {
  return h('div', { class: 'detail' },
    word.pos.map((group, gi) => h('section', { class: 'pos', 'data-enter': '' },
      h('span', { class: 'pos-chip' }, POS_KO[group.p] || group.p),
      h('ol', { class: 'senses' }, group.senses.map((sense, si) => h('li', { class: 'sense' },
        h('strong', { class: 'sense-ko' }, sense.ko,
          gi === 0 && si === 0 ? h('span', { class: 'origin-tag' }, '원문 뜻') : null),
        h('span', { class: 'sense-en', lang: 'en' }, sense.en)))))),
    word.ph.length ? h('section', { 'data-enter': '' },
      h('h3', { class: 'section-title' }, '표현·숙어'),
      h('ul', { class: 'phrases' }, word.ph.map(p => h('li', { class: 'phrase' },
        h('span', { class: 'phrase-t', lang: 'en' }, p.t),
        h('span', { class: 'phrase-ko' }, p.ko))))) : null,
    h('section', { 'data-enter': '' },
      h('h3', { class: 'section-title' }, '예문'),
      example(word)));
}

function example(word) {
  return h('div', { class: 'example' },
    h('p', { class: 'example-en', lang: 'en' }, emphasize(word.ex.en, word.w)),
    h('p', { class: 'example-ko' }, word.ex.ko));
}

function wordRow(word, trailing, onclick) {
  return h('button', { class: 'row', type: 'button', onclick },
    h('span', { class: 'row-main' },
      h('span', { class: 'row-word', lang: 'en' }, word.w),
      h('span', { class: 'row-ko' }, headline(word))),
    trailing);
}

/* ---------- overlays: bottom sheets and dialogs ---------- */

const OVERLAYS = {
  sheet: {
    frames: [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
    inMs: 620,
    outMs: 380,
    wrap: content => [h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }), h('div', { class: 'sheet-scroll' }, content)],
  },
  dialog: {
    frames: [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }],
    inMs: 420,
    outMs: 240,
    wrap: content => [content],
  },
};
const overlays = [];

function syncInert() {
  dom.app.inert = overlays.length > 0;
  overlays.forEach((o, i) => { o.layer.inert = i < overlays.length - 1; });
}

function openOverlay(kind, content, onClose) {
  const spec = OVERLAYS[kind];
  const returnFocus = document.activeElement;
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  const panel = h('div', { class: kind, role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, spec.wrap(content));
  const layer = h('div', { class: `layer layer-${kind}` }, scrim, panel);
  const entry = { layer, close };
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    overlays.splice(overlays.indexOf(entry), 1);
    layer.style.pointerEvents = 'none';
    syncInert();
    Promise.all([
      animate(panel, [...spec.frames].reverse(), spec.outMs, { fill: 'forwards' }),
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], spec.outMs, { fill: 'forwards' }),
    ]).then(() => layer.remove());
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    if (onClose) onClose();
  }

  overlays.push(entry);
  dom.phone.append(layer);
  syncInert();
  animate(panel, spec.frames, spec.inMs);
  animate(scrim, [{ opacity: 0 }, { opacity: 1 }], spec.inMs);
  panel.focus({ preventScroll: true });
  return close;
}

function goalPicker(initial, onChange) {
  let goal = initial;
  const value = h('output', { class: 'stepper-value', 'aria-live': 'polite' });
  const minus = iconButton('minus', `목표 ${GOAL_STEP}개 줄이기`, () => set(stepGoal(goal, -1)), 'soft');
  const plus = iconButton('plus', `목표 ${GOAL_STEP}개 늘리기`, () => set(stepGoal(goal, 1)), 'soft');
  const chips = GOAL_PRESETS.map(preset => h('button', { class: 'chip', type: 'button', 'aria-label': `${preset}개`, onclick: () => set(preset) }, `${preset}`));
  const render = () => {
    value.textContent = `${goal}개`;
    minus.disabled = goal <= GOAL_MIN;
    plus.disabled = goal >= GOAL_MAX;
    chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(GOAL_PRESETS[i] === goal)));
  };
  function set(next) {
    if (next === goal) return;
    goal = next;
    render();
    onChange(goal);
  }
  render();
  return h('div', { class: 'goal-picker' },
    h('div', { class: 'stepper', role: 'group', 'aria-label': '하루 목표 단어 수' }, minus, value, plus),
    h('div', { class: 'chips', role: 'group', 'aria-label': '추천 목표' }, chips));
}

const finishDays = goal => Math.ceil(TOTAL / goal);

function openGoalSheet() {
  let goal = state.goal;
  const hint = h('p', { class: 'goal-hint' });
  const confirm = btn('', 'primary', () => {
    commit(finishOnboarding(state, goal));
    close();
    root('home', 'fade');
  });
  const sync = () => {
    hint.textContent = `하루 ${goal}개씩이면 ${finishDays(goal)}일 만에 ${TOTAL}개를 끝내요.`;
    confirm.textContent = `하루 ${goal}개로 시작하기`;
  };
  const close = openOverlay('sheet', h('div', { class: 'sheet-content' },
    h('h2', { class: 'sheet-title' }, '하루에 몇 개씩 외울까요?'),
    h('p', { class: 'sheet-sub' }, '설정에서 언제든 바꿀 수 있어요.'),
    goalPicker(goal, g => { goal = g; sync(); }),
    hint,
    h('div', { class: 'sheet-actions' }, confirm)));
  sync();
}

function openSettings() {
  const before = state;
  const close = openOverlay('sheet', h('div', { class: 'sheet-content' },
    h('div', { class: 'sheet-top' },
      h('h2', { class: 'sheet-title' }, '설정'),
      iconButton('close', '닫기', () => close(), 'soft')),
    h('h3', { class: 'section-title' }, '하루 목표'),
    goalPicker(state.goal, goal => commit(setGoal(state, goal))),
    h('h3', { class: 'section-title' }, '학습 기록'),
    h('p', { class: 'note' }, '학습 기록은 이 기기의 브라우저에만 저장돼요. 브라우저 데이터를 지우면 함께 사라져요.'),
    h('div', { class: 'sheet-actions' }, btn('학습 기록 초기화', 'danger-soft', () => confirmReset(close)))),
  () => { if (state !== before) refresh(); });
}

function confirmReset(closeSettings) {
  const close = openOverlay('dialog', h('div', { class: 'dialog-content' },
    h('h2', { class: 'dialog-title' }, '학습 기록을 초기화할까요?'),
    h('p', { class: 'note' }, '외운 단어, 복습 일정, 연속 학습일이 모두 지워져요. 되돌릴 수 없어요.'),
    h('div', { class: 'dialog-actions' },
      btn('취소', 'secondary', () => close()),
      btn('초기화', 'danger', () => {
        commit(resetProgress(state));
        close();
        closeSettings();
      }))));
}

function openWordSheet(word) {
  const card = state.cards[word.id];
  const status = statusOf(card);
  const content = h('div', { class: 'sheet-content' },
    h('div', { class: 'sheet-top' },
      h('span', { class: 'status-chip', 'data-status': status }, STATUS[status], card ? ` · 다음 복습 ${formatShortDate(card.due)}` : ''),
      iconButton('close', '닫기', () => close(), 'soft')),
    wordHead(word),
    wordDetail(word));
  const close = openOverlay('sheet', content);
  playEntrance(content);
}

/* ---------- screens ---------- */

function SplashScreen() {
  return h('section', { class: 'screen screen-splash' },
    h('h1', { class: 'wordmark', 'data-enter': '', 'aria-label': '스포큰721' },
      h('span', { 'aria-hidden': 'true' }, 'spoken'),
      h('span', { class: 'wordmark-num', 'aria-hidden': 'true' }, '721')));
}

function OnboardingScreen() {
  return h('section', { class: 'screen' },
    h('div', { class: 'scroll onb' },
      h('div', { class: 'onb-inner' },
        h('div', { class: 'onb-hero', 'data-enter': '', 'aria-hidden': 'true' },
          h('div', { class: 'onb-blob' }),
          h('div', { class: 'float float-a' }, h('div', { class: 'hero-card bob' },
            h('span', { class: 'tag' }, '오늘의 단어'),
            h('strong', { class: 'hero-word', lang: 'en' }, 'absolutely'),
            h('span', { class: 'hero-def' }, h('em', {}, '영영'), h('span', { lang: 'en' }, 'completely')),
            h('span', { class: 'hero-ko' }, '완전히'))),
          h('div', { class: 'float float-b' }, h('div', { class: 'hero-dark bob bob-late' },
            count(721, 'hero-num'),
            h('span', {}, '개 회화 고빈도 단어')))),
        title('하루 몇 개씩,\n721개를 끝까지'),
        h('p', { class: 'body', 'data-enter': '' }, '영어 정의와 한글 뜻으로 익히고, 퀴즈로 복습해요. 연속 학습일과 주간 목표로 매일 얼마나 외웠는지 확인해요.'))),
    h('div', { class: 'bar', 'data-bar': '' }, btn('시작하기', 'primary', openGoalSheet)));
}

const GREETINGS = [
  { until: 5, text: '늦은 밤까지 수고해요' },
  { until: 12, text: '좋은 아침이에요' },
  { until: 18, text: '좋은 오후예요' },
  { until: 24, text: '좋은 저녁이에요' },
];

function todayMessage(o) {
  if (o.goalMet) return '오늘 목표를 달성했어요';
  if (o.todayLearned === 0) return `오늘 ${o.goal}개를 외워 볼까요?`;
  return `${o.goal - o.todayLearned}개 남았어요`;
}

function learnCta(o) {
  if (o.newLeft === 0) return { label: `${TOTAL}개를 모두 학습했어요`, disabled: true };
  return { label: o.goalMet ? '목표 달성! 더 외우기' : `오늘의 단어 ${o.sessionSize}개 외우기`, disabled: false };
}

function streakCopy(o) {
  if (o.activeToday) return '오늘도 이어 갔어요';
  return o.streak ? '오늘 학습하면 이어져요' : '오늘부터 시작해요';
}

function reviewCopy(o) {
  if (o.learned === 0) return '단어를 외우면 복습 일정이 생겨요';
  if (o.learned < MIN_QUIZ_WORDS) return `단어를 ${MIN_QUIZ_WORDS}개 이상 외우면 퀴즈가 열려요`;
  return '오늘 복습은 끝났어요';
}

function todayCard(o) {
  const cta = learnCta(o);
  return h('section', { class: 'card today', 'data-enter': '' },
    h('div', { class: 'today-top' },
      ring(Math.min(1, o.todayLearned / o.goal), 104, 10, [
        count(o.todayLearned, 'ring-num'),
        h('span', { class: 'ring-of' }, `/ ${o.goal}개`),
      ]),
      h('div', { class: 'today-text' },
        h('p', { class: 'eyebrow' }, '오늘의 목표'),
        h('p', { class: 'today-msg' }, todayMessage(o)))),
    btn(cta.label, 'primary', () => push('learn', { ids: nextNewIds(state, o.sessionSize) }), { disabled: cta.disabled }));
}

function statsRow(o) {
  return h('div', { class: 'stats', 'data-enter': '' },
    h('section', { class: 'card stat' },
      h('p', { class: 'stat-label' }, icon('flame'), '연속 학습일'),
      h('p', { class: 'stat-value' }, count(o.streak), h('span', {}, '일')),
      h('p', { class: 'stat-sub' }, streakCopy(o))),
    h('section', { class: 'card stat' },
      h('p', { class: 'stat-label' }, icon('leaf'), '외운 단어'),
      h('p', { class: 'stat-value' }, count(o.mastered), h('span', {}, ` / ${TOTAL}`)),
      meter(TOTAL ? o.mastered / TOTAL : 0)));
}

function weekCard(o) {
  return h('section', { class: 'card week', 'data-enter': '' },
    h('div', { class: 'week-head' },
      h('h2', { class: 'card-title' }, '주간 목표'),
      h('p', { class: `week-cap${o.activeDays >= WEEK_TARGET ? ' is-met' : ''}` }, `이번 주 ${Math.min(o.activeDays, 7)} / ${WEEK_TARGET}일`)),
    h('ol', { class: 'week-days' }, o.week.map((d, i) => h('li', {
      class: `wk-day${d.today ? ' is-today' : ''}${d.active ? ' is-active' : ''}`,
      'aria-label': `${WEEKDAYS_FROM_MON[i]}요일 ${d.learned}개${d.today ? ', 오늘' : ''}`,
    },
    h('span', { class: 'wk-bar' }, h('i', { 'data-fill': Math.min(1, d.learned / o.goal), 'data-kind': 'y' })),
    h('span', { class: 'wk-label', 'aria-hidden': 'true' }, WEEKDAYS_FROM_MON[i])))));
}

function reviewCard(o) {
  if (o.due > 0) {
    return h('button', { class: 'card review', type: 'button', 'data-enter': '', onclick: () => push('quiz') },
      h('span', { class: 'review-ic' }, icon('repeat')),
      h('span', { class: 'review-text' },
        h('strong', {}, `복습할 단어 ${o.due}개`),
        h('span', {}, '퀴즈로 기억을 단단하게 다져요')),
      icon('chevron'));
  }
  return h('section', { class: 'card review is-empty', 'data-enter': '' },
    h('span', { class: 'review-ic' }, icon('repeat')),
    h('span', { class: 'review-text' },
      h('strong', {}, '복습할 단어가 없어요'),
      h('span', {}, reviewCopy(o))),
    o.learned >= MIN_QUIZ_WORDS ? btn('연습 퀴즈', 'secondary btn-sm', () => push('quiz')) : null);
}

function HomeScreen() {
  const now = new Date();
  const o = overview(state, dayKey(now));
  const hour = now.getHours();
  return h('section', { class: 'screen' },
    h('div', { class: 'scroll' },
      h('header', { class: 'home-head' },
        h('div', {},
          h('p', { class: 'eyebrow', 'data-enter': '' }, formatLongDate(now)),
          title(GREETINGS.find(g => hour < g.until).text)),
        h('div', { 'data-enter': '' }, iconButton('sliders', '설정', openSettings))),
      h('div', { class: 'home-blocks' }, todayCard(o), statsRow(o), weekCard(o), reviewCard(o))));
}

const wordsView = { query: '', filter: 'all', rows: null, list: null };

function buildRows() {
  return WORDS.map(word => {
    const label = h('span', { class: 'sr' });
    const row = { id: word.id, text: searchText(word), status: 'new', label };
    row.el = wordRow(word, [label, h('span', { class: 'dot', 'aria-hidden': 'true' })], () => openWordSheet(word));
    return row;
  });
}

function WordsScreen() {
  const view = wordsView;
  if (!view.rows) {
    view.rows = buildRows();
    view.list = h('div', { class: 'list-inner' }, view.rows.map(r => r.el));
  }
  for (const row of view.rows) {
    row.status = statusOf(state.cards[row.id]);
    row.el.dataset.status = row.status;
    row.label.textContent = STATUS[row.status];
  }
  const meta = h('p', { class: 'list-meta', 'aria-live': 'polite' });
  const empty = h('p', { class: 'empty-note', hidden: true }, '찾는 단어가 없어요');
  const apply = () => {
    const q = view.query.trim().toLowerCase();
    let shown = 0;
    for (const row of view.rows) {
      const match = (view.filter === 'all' || row.status === view.filter) && (!q || row.text.includes(q));
      row.el.hidden = !match;
      if (match) shown += 1;
    }
    meta.textContent = q ? `검색 결과 ${shown}개` : `${shown}개`;
    empty.hidden = shown > 0;
  };
  const input = h('input', {
    class: 'search-input', type: 'search', placeholder: '영어 단어나 한글 뜻으로 검색', 'aria-label': '단어 검색',
    enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    oninput: e => { view.query = e.target.value; apply(); },
  });
  input.value = view.query;
  const chips = FILTERS.map(f => h('button', {
    class: 'chip chip-sm', type: 'button', 'aria-pressed': String(f.id === view.filter),
    onclick: () => {
      view.filter = f.id;
      chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(FILTERS[i].id === f.id)));
      apply();
    },
  }, f.label));
  apply();
  return h('section', { class: 'screen' },
    h('div', { class: 'words-head' },
      h('p', { class: 'eyebrow', 'data-enter': '' }, `NGSL-Spoken ${TOTAL}`),
      title('단어장'),
      h('label', { class: 'search', 'data-enter': '' }, icon('search'), input),
      h('div', { class: 'filters', role: 'group', 'aria-label': '학습 상태', 'data-enter': '' }, chips)),
    h('div', { class: 'scroll words-scroll' },
      h('div', { 'data-enter': '' }, meta, h('div', { class: 'list' }, view.list), empty)));
}

function topbar(progressFill, counter) {
  return h('div', { class: 'topbar', 'data-enter': '' },
    iconButton('close', '닫기', back),
    progressFill ? h('div', { class: 'progress', 'aria-hidden': 'true' }, progressFill) : h('div', { class: 'grow' }),
    counter);
}

function setCount(el, n) {
  if (el.textContent === String(n)) return;
  el.textContent = String(n);
  animate(el.parentNode, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 320, { easing: EASE_OUT });
}

const doneStat = (label, n, tone) => h('section', { class: `card stat stat-${tone}` },
  h('p', { class: 'stat-label' }, label),
  h('p', { class: 'stat-value' }, count(n), h('span', {}, '개')));

function LearnScreen({ ids }) {
  let session = learnStart(ids);
  let card = null;
  let busy = false;
  const screen = h('section', { class: 'screen' });
  const fill = h('i');
  const counter = h('span', { class: 'progress-text' });
  const unsureCount = h('b', {}, '0');
  const knownCount = h('b', {}, '0');
  const body = h('div', { class: 'scroll scroll-flush' });
  const hint = h('p', { class: 'swipe-hint', 'aria-hidden': 'true' },
    h('span', { class: 'hint-unsure' }, '← 헷갈려요'), ' · ', h('span', { class: 'hint-know' }, '알아요 →'));
  const unsure = btn('헷갈려요', 'unsure', () => act('unsure'));
  const know = btn('알아요', 'primary', () => act('know'));
  const confirm = btn('확인했어요', 'primary', () => act('unsure'));
  const bar = h('div', { class: 'bar', 'data-bar': '' }, unsure, know);
  screen.append(
    topbar(fill, counter),
    h('div', { class: 'tally', 'data-enter': '' },
      h('span', { class: 'pill pill-warn' }, '헷갈려요', unsureCount),
      h('span', { class: 'pill pill-ok' }, '알아요', knownCount)),
    body,
    bar);

  function sync() {
    const t = learnTally(session);
    fill.style.transform = `scaleX(${t.total ? t.known / t.total : 1})`;
    counter.textContent = `${t.known} / ${t.total}`;
    setCount(unsureCount, t.unsure);
    setCount(knownCount, t.known);
    hint.hidden = state.swiped || session.phase === 'confirm';
  }

  function showCard(enter) {
    const word = BY_ID.get(session.queue[0]);
    const stamps = {
      know: h('span', { class: 'stamp stamp-know' }, '알아요'),
      unsure: h('span', { class: 'stamp stamp-unsure' }, '헷갈려요'),
    };
    const reveal = btn('뜻 보기', 'secondary btn-reveal', () => act('reveal'));
    const el = h('article', { class: 'card learn-card', 'data-enter': '' },
      h('div', { class: 'stamps', 'aria-hidden': 'true' }, stamps.know, stamps.unsure),
      wordHead(word),
      reveal);
    card = { el, stamps, reveal, detail: wordDetail(word) };
    swipeCard(el, stamps, {
      canStart: () => !busy && session.phase !== 'confirm',
      onCommit: dir => {
        if (!state.swiped) commit(markSwiped(state));
        return act(dir > 0 ? 'know' : 'unsure', dir);
      },
    });
    if (bar.firstChild === confirm) bar.replaceChildren(unsure, know);
    body.replaceChildren(el, hint);
    body.scrollTop = 0;
    sync();
    if (enter) animate(el, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], 320, { easing: EASE_OUT });
  }

  function turnOver() {
    if (card.reveal.isConnected) {
      card.reveal.replaceWith(card.detail);
      playEntrance(card.detail);
    }
    if (session.phase === 'confirm') {
      bar.replaceChildren(confirm);
      animate(confirm, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], 420, { easing: EASE_OUT });
      confirm.focus({ preventScroll: true });
    }
    sync();
  }

  function showDone(played) {
    const t = learnTally(session);
    screen.replaceChildren(
      topbar(null, null),
      h('div', { class: 'scroll scroll-flush done' },
        illo('check'),
        h('p', { class: 'done-count', 'data-enter': '' }, count(t.total), h('span', {}, '개')),
        title('오늘의 단어를 익혔어요', 'title center'),
        h('div', { class: 'stats done-split', 'data-enter': '' },
          doneStat('한 번에 알았어요', t.total - t.reviewed, 'ok'),
          doneStat('다시 보고 외웠어요', t.reviewed, 'warn')),
        h('p', { class: 'body center', 'data-enter': '' }, t.reviewed
          ? `다시 본 ${t.reviewed}개는 내일 복습 퀴즈에 나와요.`
          : '복습 일정에 맞춰 퀴즈로 다시 만나요.')),
      h('div', { class: 'bar', 'data-bar': '' },
        btn('홈으로', 'secondary', back),
        btn('퀴즈로 복습', 'primary', () => replaceTop('quiz'))));
    if (played) {
      playEntrance(screen);
      playMounted(screen);
    }
  }

  // Returns whether the card leaves, so a swipe that only turned it over springs back.
  function act(move, dir = move === 'know' ? 1 : -1) {
    if (busy) return false;
    const next = learnMove(state, session, move, todayKey());
    if (next.session === session) return false;
    session = next.session;
    if (!next.answered) {
      turnOver();
      return false;
    }
    commit(next.state);
    busy = true;
    sync();
    flyOff(card.el, dir > 0 ? card.stamps.know : card.stamps.unsure, dir).then(() => {
      busy = false;
      if (session.phase === 'done') showDone(true);
      else showCard(true);
    });
    return true;
  }

  if (session.phase === 'done') showDone(false);
  else showCard(false);
  return screen;
}

function wordPrompt(word) {
  return h('div', { class: 'q-word-line' },
    h('p', { class: `q-word${word.w.length > LONG_WORD ? ' is-long' : ''}`, lang: 'en' }, word.w),
    speakerButton(word.w));
}

const defPrompt = word => h('p', { class: 'q-def', lang: 'en' }, word.def);

const SCORE_MESSAGES = [
  { min: 1, text: '완벽해요!' },
  { min: 0.7, text: '잘했어요' },
  { min: 0.4, text: '조금만 더 힘내요' },
  { min: 0, text: '복습이 더 필요해요' },
];

const FEEDBACK = {
  correct: {
    title: '정답이에요',
    icon: 'check',
    summary: word => h('p', { class: 'qf-word' }, h('strong', { lang: 'en' }, word.w), h('span', {}, headline(word))),
  },
  wrong: {
    title: '다시 볼 단어예요',
    icon: 'close',
    summary: (word, q, picked) => {
      const type = QUESTION_TYPES[q.type];
      return h('dl', { class: 'qf-rows' },
        h('dt', {}, '정답'),
        h('dd', { class: 'qf-right' },
          h('span', { lang: type.optionLang }, q.answer),
          type.gloss ? h('span', { class: 'qf-gloss' }, type.gloss(word)) : null),
        h('dt', {}, '내가 고른 답'),
        h('dd', { class: 'qf-picked', lang: type.optionLang }, picked));
    },
  },
};

function feedbackSheet(q, picked, next) {
  const word = BY_ID.get(q.id);
  const result = picked === q.answer ? 'correct' : 'wrong';
  const fb = FEEDBACK[result];
  return h('div', { class: 'qsheet', 'data-result': result },
    h('div', { class: 'qfeed' },
      h('p', { class: 'qf-head' }, icon(fb.icon), fb.title),
      fb.summary(word, q, picked),
      example(word)),
    h('div', { class: 'bar' }, next));
}

function QuizEmpty() {
  const learned = learnedIds(state).length;
  return h('section', { class: 'screen' },
    topbar(null, null),
    h('div', { class: 'scroll scroll-flush done' },
      illo('cards'),
      title(`단어를 ${MIN_QUIZ_WORDS}개 이상 외우면\n퀴즈를 풀 수 있어요`, 'title center'),
      h('p', { class: 'body center', 'data-enter': '' }, `지금까지 ${learned}개를 외웠어요. 오늘의 단어부터 시작해 볼까요?`)),
    h('div', { class: 'bar', 'data-bar': '' },
      btn('단어 외우러 가기', 'primary', () => replaceTop('learn', { ids: nextNewIds(state, state.goal) }))));
}

function QuizScreen() {
  const questions = buildQuiz(state, todayKey(), Math.random);
  if (!questions.length) return QuizEmpty();
  let session = quizStart(questions);
  const screen = h('section', { class: 'screen' });
  const fill = h('i');
  const counter = h('span', { class: 'progress-text' });
  const body = h('div', { class: 'scroll scroll-flush' });
  const dock = h('div', { class: 'dock' });
  const announcer = h('p', { class: 'sr', 'aria-live': 'polite' });
  screen.append(topbar(fill, counter), body, dock, announcer);
  let optionEls = [];

  function sync() {
    const total = session.questions.length;
    const done = session.i + (session.phase === 'ask' ? 0 : 1);
    fill.style.transform = `scaleX(${done / total})`;
    counter.textContent = `${Math.min(session.i + 1, total)} / ${total}`;
  }

  function showQuestion(slideIn) {
    const q = session.questions[session.i];
    const type = QUESTION_TYPES[q.type];
    optionEls = q.options.map(text => h('button', { class: 'option', type: 'button', lang: type.optionLang, onclick: () => pick(text) },
      h('span', {}, text),
      h('span', { class: 'option-mark' })));
    const view = h('div', { class: 'q' },
      h('div', { class: 'card q-prompt', 'data-enter': '' },
        h('p', { class: 'eyebrow' }, type.label),
        type.prompt(BY_ID.get(q.id))),
      h('div', { class: 'options', 'data-enter': '' }, optionEls));
    body.replaceChildren(view);
    body.scrollTop = 0;
    sync();
    if (slideIn) animate(view, [{ opacity: 0, transform: 'translateX(36px)' }, { opacity: 1, transform: 'none' }], 420, { easing: EASE_OUT });
  }

  function pick(text) {
    if (session.phase !== 'ask') return;
    const q = session.questions[session.i];
    const correct = text === q.answer;
    commit(answerQuiz(state, q.id, correct, todayKey()));
    session = quizPick(session, text);
    optionEls.forEach((el, i) => {
      const option = q.options[i];
      const mark = option === q.answer ? 'correct' : option === text ? 'wrong' : 'rest';
      el.dataset.state = mark;
      el.disabled = true;
      if (mark !== 'rest') el.lastChild.replaceChildren(icon(mark === 'correct' ? 'check' : 'close'));
    });
    announcer.textContent = correct ? FEEDBACK.correct.title : `${FEEDBACK.wrong.title}. 정답은 ${q.answer}`;
    const last = session.i === session.questions.length - 1;
    const next = btn(last ? '결과 보기' : '다음', 'primary', advance);
    const sheet = feedbackSheet(q, text, next);
    dock.replaceChildren(sheet);
    animate(sheet, OVERLAYS.sheet.frames, OVERLAYS.sheet.inMs);
    body.scrollTo({ top: body.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    next.focus({ preventScroll: true });
    sync();
  }

  function advance() {
    if (session.phase !== 'answered') return;
    session = quizNext(session);
    const sheet = dock.firstElementChild;
    animate(sheet, [...OVERLAYS.sheet.frames].reverse(), OVERLAYS.sheet.outMs, { fill: 'forwards' }).then(() => sheet.remove());
    animate(body.firstElementChild, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-36px)' }], 180, { easing: 'ease-in', fill: 'forwards' })
      .then(() => (session.phase === 'done' ? showResult() : showQuestion(true)));
  }

  function showResult() {
    const total = session.questions.length;
    const message = SCORE_MESSAGES.find(m => session.score / total >= m.min).text;
    const missed = session.missed.map(id => BY_ID.get(id));
    screen.replaceChildren(
      topbar(null, null),
      h('div', { class: 'scroll scroll-flush result' },
        h('div', { class: 'result-ring', 'data-enter': '' },
          ring(session.score / total, 168, 14, [count(session.score, 'result-num'), h('span', { class: 'ring-of' }, `/ ${total}`)])),
        title(message, 'title center'),
        h('p', { class: 'body center', 'data-enter': '' }, missed.length
          ? `틀린 ${missed.length}개는 내일 복습 퀴즈에 다시 나와요.`
          : '한 문제도 틀리지 않았어요.'),
        missed.length ? h('section', { class: 'missed', 'data-enter': '' },
          h('h3', { class: 'section-title' }, '틀린 단어'),
          h('div', { class: 'list' }, h('div', { class: 'list-inner' },
            missed.map(word => wordRow(word, icon('chevron'), () => openWordSheet(word)))))) : null),
      h('div', { class: 'bar', 'data-bar': '' },
        btn('다시 풀기', 'secondary', () => replaceTop('quiz')),
        btn('홈으로', 'primary', back)));
    playEntrance(screen);
    playMounted(screen);
  }

  showQuestion(false);
  return screen;
}

/* ---------- navigation ---------- */

const SCREENS = {
  splash: { tab: null, build: SplashScreen },
  onboarding: { tab: null, build: OnboardingScreen },
  home: { tab: 'home', build: HomeScreen },
  words: { tab: 'words', build: WordsScreen },
  learn: { tab: null, build: LearnScreen },
  quiz: { tab: null, build: QuizScreen },
};

const TABS = [
  { id: 'home', label: '홈', icon: 'home' },
  { id: 'words', label: '단어장', icon: 'book' },
];

const DIM = { filter: 'brightness(.92)' };
const LIT = { filter: 'brightness(1)' };
const TRANSITIONS = {
  appear: { entrance: true },
  refresh: { entrance: false },
  fade: {
    entrance: true,
    in: { frames: [{ opacity: 0 }, { opacity: 1 }], ms: 360 },
    out: { frames: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.04)' }], ms: 460 },
  },
  tab: { entrance: true, in: { frames: [{ opacity: 0 }, { opacity: 1 }], ms: 360 } },
  push: {
    entrance: true,
    in: { frames: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], ms: 460 },
    out: { frames: [{ transform: 'translateX(0)', ...LIT }, { transform: 'translateX(-28%)', ...DIM }], ms: 460 },
  },
  back: {
    entrance: false,
    under: true,
    in: { frames: [{ transform: 'translateX(-28%)', ...DIM }, { transform: 'translateX(0)', ...LIT }], ms: 420 },
    out: { frames: [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], ms: 420 },
  },
};

let navStack = [];
let currentScreen = null;
let navBusy = false;
let shownDay = '';

function syncTabbar(activeTab) {
  dom.tabbar.classList.toggle('is-hidden', !activeTab);
  dom.tabbar.inert = !activeTab;
  for (const button of dom.tabbar.children) {
    if (button.dataset.tab === activeTab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function show(how) {
  const t = TRANSITIONS[how];
  const { name, params } = navStack[navStack.length - 1];
  const def = SCREENS[name];
  const next = def.build(params || {});
  next.classList.toggle('screen-tabbed', Boolean(def.tab));
  const prev = currentScreen;
  currentScreen = next;
  shownDay = todayKey();
  if (prev && t.under) dom.stage.insertBefore(next, prev);
  else dom.stage.append(next);
  syncTabbar(def.tab);
  if (t.entrance) playEntrance(next);
  playMounted(next);
  if (!prev) return;
  navBusy = true;
  Promise.all([
    t.in && animate(next, t.in.frames, t.in.ms),
    t.out && animate(prev, t.out.frames, t.out.ms, { fill: 'forwards' }),
  ]).then(() => {
    prev.remove();
    navBusy = false;
  });
}

function push(name, params) {
  if (navBusy) return;
  navStack.push({ name, params });
  show('push');
}

function replaceTop(name, params) {
  if (navBusy) return;
  navStack[navStack.length - 1] = { name, params };
  show('push');
}

function back() {
  if (navBusy || navStack.length < 2) return;
  navStack.pop();
  show('back');
}

function root(name, how) {
  if (navBusy) return;
  navStack = [{ name }];
  show(how);
}

const refresh = () => show('refresh');
const currentTab = () => SCREENS[navStack[navStack.length - 1].name].tab;

function buildTabbar() {
  dom.tabbar.append(...TABS.map(tab => h('button', {
    class: 'tab', type: 'button', 'data-tab': tab.id,
    onclick: () => { if (currentTab() !== tab.id) root(tab.id, 'tab'); },
  }, icon(tab.icon), h('span', {}, tab.label))));
}

function boot() {
  dom = {
    phone: document.getElementById('phone'),
    app: document.getElementById('app'),
    stage: document.getElementById('stage'),
    tabbar: document.getElementById('tabbar'),
  };
  state = loadState();
  buildTabbar();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlays.length) overlays[overlays.length - 1].close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && shownDay !== todayKey() && currentTab() && !overlays.length) refresh();
  });
  navStack = [{ name: 'splash' }];
  show('appear');
  setTimeout(() => root(state.onboarded ? 'home' : 'onboarding', 'fade'), SPLASH_MS);
}

document.addEventListener('DOMContentLoaded', boot);

// 語音工具封裝
const Speech = (() => {
  /** 朗讀文字。lang: 'en-US' | 'es-ES' | 'ja-JP' 等 */
  function speak(text, lang) {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  return { speak };
})();

// 語音辨識（可用則提供跟讀）
const Recognizer = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return { available: false };
  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  function recognizeOnce(lang) {
    return new Promise((resolve, reject) => {
      try {
        rec.lang = lang;
        rec.onresult = (e) => {
          const text = e.results?.[0]?.[0]?.transcript ?? '';
          resolve(text);
        };
        rec.onerror = (e) => reject(e.error || 'recognition-error');
        rec.onend = () => {};
        rec.start();
      } catch (e) {
        reject(e);
      }
    });
  }

  return { available: true, recognizeOnce };
})();

// 語系對應
const LANG_META = {
  en: { label: '英語', tts: 'en-US' },
  es: { label: '西班牙語', tts: 'es-ES' },
  ja: { label: '日語', tts: 'ja-JP' },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  lang: 'en',
  cardCategory: 'all',
  cardIndex: 0,
  showBack: false,
  // 會話
  sceneId: null,
};

function init() {
  // 擴充資料至指定數量，便於大量練習
  expandDataset({ targetDeckCards: 500, targetConversationScenes: 250 });
  bindTabs();
  initLangSelect();
  initDecks();
  initCardsView();
  initConvoView();
  initFilters();
}

function bindTabs() {
  const tabs = $$('.tab');
  tabs.forEach((t) => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });
}

function switchView(view) {
  $$('#tabCards, #tabConvo').forEach((el) => {
    const isActive = el.dataset.view === view;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', String(isActive));
  });
  $$('#viewCards, #viewConvo').forEach((el) => el.classList.remove('active'));
  if (view === 'cards') $('#viewCards').classList.add('active');
  if (view === 'convo') $('#viewConvo').classList.add('active');
}

function initLangSelect() {
  const sel = $('#langSelect');
  sel.value = state.lang;
  sel.addEventListener('change', () => {
    state.lang = sel.value;
    renderCard();
    renderDialogue();
  });
}

function initDecks() {
  // 主題下拉已移除，改以分類聚合卡片，這裡保留以兼容初始化流程
}

function initCardsView() {
  $('#btnFlip').addEventListener('click', flipCard);
  $('#btnAgain').addEventListener('click', () => nextCard(false));
  $('#btnGood').addEventListener('click', () => nextCard(true));
  $('#btnSpeak').addEventListener('click', () => speakCurrent());
  const shadowBtn = $('#btnShadow');
  if (shadowBtn) {
    shadowBtn.disabled = !Recognizer.available;
    shadowBtn.title = Recognizer.available ? '' : '此瀏覽器不支援語音辨識';
    shadowBtn.addEventListener('click', shadowOnce);
  }
  $('#flashcard').addEventListener('click', flipCard);
  $('#flashcard').addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flipCard();
    }
    if (e.key === 'ArrowRight') nextCard(true);
    if (e.key === 'ArrowLeft') nextCard(false);
  });
  renderCard();
}

function getCards() {
  const decks = window.APP_DATA.decks || {};
  const cat = state.cardCategory;
  const list = Object.values(decks);
  const filtered = cat === 'all' ? list : list.filter((d) => (d.category || '未分類') === cat);
  let cards = [];
  filtered.forEach((d) => { if (Array.isArray(d.cards)) cards = cards.concat(d.cards); });
  return cards;
}

function currentCard() {
  return getCards()[state.cardIndex];
}

function renderCard() {
  const cards = getCards();
  const card = currentCard();
  const lang = state.lang;
  const front = card?.[lang] || (cards.length === 0 ? '（此分類暫無卡片）' : '—');
  const back = card ? `${card?.zh ?? ''}${card?.note ? `\n${card.note}` : ''}` : '';
  $('#cardFront').textContent = front;
  $('#cardBack').textContent = back;
  $('#flashcard').classList.toggle('flipped', state.showBack);
  $('#cardsProgress').textContent = `${state.cardIndex + 1} / ${cards.length}`;
}

function flipCard() {
  state.showBack = !state.showBack;
  renderCard();
}

function nextCard(markGood) {
  // 將簡單的間隔重複留白：這裡僅示意，實作為循序前進
  const cards = getCards();
  if (cards.length === 0) return;
  state.cardIndex = (state.cardIndex + 1) % cards.length;
  state.showBack = false;
  renderCard();
}

function speakCurrent() {
  const card = currentCard();
  if (!card) return;
  const langCode = LANG_META[state.lang].tts;
  Speech.speak(card[state.lang], langCode);
}

async function shadowOnce() {
  const out = document.getElementById('shadowOut');
  const card = currentCard();
  if (!Recognizer.available || !card) return;
  out.textContent = '請開始說話…';
  try {
    const langCode = LANG_META[state.lang].tts;
    const heard = await Recognizer.recognizeOnce(langCode);
    const target = card[state.lang];
    const score = Math.round(simpleSimilarity(heard, target) * 100);
    out.textContent = `你說：${heard} ｜ 目標：${target} ｜ 相似度：${score}%`;
  } catch (e) {
    out.textContent = '偵測失敗，請檢查麥克風權限或瀏覽器支援。';
  }
}

// 會話視圖
function initConvoView() {
  const scenes = window.APP_DATA.conversations;
  const list = $('#sceneList');
  const scCat = $('#sceneCategorySelect')?.value || 'all';
  const filtered = scenes.filter((s) => scCat === 'all' || s.category === scCat);
  list.innerHTML = filtered
    .map((s) => `<li><button data-id="${s.id}">${s.title}</button></li>`)
    .join('');
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.sceneId = btn.dataset.id;
    renderDialogue();
  });

  $('#btnPlayAll').addEventListener('click', playAllDialogue);

  // 預設選第一個情境
  state.sceneId = (filtered[0]?.id) ?? null;
  renderDialogue();
}

function initFilters() {
  // 卡片分類
  const catSel = $('#categorySelect');
  if (catSel) {
    const deckList = Object.values(window.APP_DATA.decks || {});
    const cats = ['all', ...Array.from(new Set(deckList.map((d) => d.category || '未分類')))].filter(Boolean);
    catSel.innerHTML = cats.map((c) => `<option value="${c}">${c === 'all' ? '全部' : c}</option>`).join('');
    catSel.value = 'all';
    catSel.addEventListener('change', () => {
      state.cardCategory = catSel.value;
      state.cardIndex = 0;
      state.showBack = false;
      renderCard();
    });
  }

  // 會話分類
  const sceneCatSel = $('#sceneCategorySelect');
  if (sceneCatSel) {
    const scenes = window.APP_DATA.conversations || [];
    const cats = ['all', ...Array.from(new Set(scenes.map((s) => s.category || '未分類')))].filter(Boolean);
    sceneCatSel.innerHTML = cats.map((c) => `<option value="${c}">${c === 'all' ? '全部' : c}</option>`).join('');
    sceneCatSel.value = 'all';
    sceneCatSel.addEventListener('change', () => {
      initConvoView();
    });
  }
}

function getScene() {
  return window.APP_DATA.conversations.find((s) => s.id === state.sceneId) || null;
}

function renderDialogue() {
  const scene = getScene();
  $('#sceneTitle').textContent = scene ? scene.title : '—';
  const lang = state.lang;
  const linesEl = $('#dialogueLines');
  if (!scene) {
    linesEl.innerHTML = '';
    return;
  }
  linesEl.innerHTML = scene.lines
    .map((ln, idx) => {
      const target = ln[lang];
      const zh = ln.zh;
      return `
      <li class="line" data-idx="${idx}">
        <div class="src"><strong>${ln.role}</strong>：${target}</div>
        <div class="zh">${zh}</div>
        <div class="controls">
          <button data-action="speak">🔊 朗讀</button>
          ${Recognizer.available ? '<button data-action="shadow">🎤 跟讀</button>' : ''}
        </div>
      </li>`;
    })
    .join('');

  linesEl.onclick = async (e) => {
    const btn = e.target.closest('button');
    const item = e.target.closest('.line');
    if (!btn || !item) return;
    const idx = Number(item.dataset.idx);
    const ln = getScene().lines[idx];
    const langCode = LANG_META[state.lang].tts;
    if (btn.dataset.action === 'speak') {
      Speech.speak(ln[state.lang], langCode);
    }
    if (btn.dataset.action === 'shadow') {
      try {
        const heard = await Recognizer.recognizeOnce(langCode);
        const score = simpleSimilarity(heard, ln[state.lang]);
        item.querySelector('.zh').textContent = `（你說：${heard}） 相似度：${Math.round(score * 100)}%`;
      } catch (e) {
        alert('無法啟用語音辨識，請確認瀏覽器支援，或在 https 協定下使用。');
      }
    }
  };
}

function playAllDialogue() {
  const scene = getScene();
  if (!scene) return;
  const langCode = LANG_META[state.lang].tts;
  const queue = scene.lines.map((ln) => ln[state.lang]);
  let i = 0;
  const playNext = () => {
    if (i >= queue.length) return;
    const utter = new SpeechSynthesisUtterance(queue[i]);
    utter.lang = langCode;
    utter.onend = () => { i += 1; playNext(); };
    window.speechSynthesis.speak(utter);
  };
  window.speechSynthesis.cancel();
  playNext();
}

// 粗略相似度（Levenshtein 近似：以簡化比例計）
function simpleSimilarity(a, b) {
  a = (a || '').toLowerCase().trim();
  b = (b || '').toLowerCase().trim();
  if (!a && !b) return 1;
  const dist = editDistance(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

document.addEventListener('DOMContentLoaded', init);

// ===== 資料擴充 =====
function expandDataset(options) {
  const { targetDeckCards = 250, targetConversationScenes = 250 } = options || {};
  const data = window.APP_DATA;
  if (!data) return;

  // 1) 擴充所有卡片總數到 targetDeckCards（依分類聚合後的練習需求）
  if (data.decks) {
    const decks = Object.values(data.decks);
    const allBase = [];
    decks.forEach((d) => {
      if (Array.isArray(d.cards)) allBase.push(...d.cards);
    });
    if (allBase.length > 0) {
      // 平均補到各 deck，避免單一 deck 過大
      let i = 0;
      while (decks.reduce((sum, d) => sum + (d.cards?.length || 0), 0) < targetDeckCards) {
        const src = allBase[i % allBase.length];
        // 輪流推入各 deck
        const deck = decks[i % decks.length];
        deck.cards = deck.cards || [];
        deck.cards.push({ ...src });
        i += 1;
      }
    }
  }

  // 2) 擴充日常會話到 targetConversationScenes（依情境數量複製）
  if (Array.isArray(data.conversations)) {
    const baseScenes = data.conversations.slice();
    if (baseScenes.length === 0) return;
    let suffix = 1;
    while (data.conversations.length < targetConversationScenes) {
      for (const scene of baseScenes) {
        if (data.conversations.length >= targetConversationScenes) break;
        const cloned = {
          id: `${scene.id}-${suffix}`,
          title: `${scene.title} (${suffix})`,
          category: scene.category,
          lines: scene.lines.map((ln) => ({ ...ln })),
        };
        data.conversations.push(cloned);
      }
      suffix += 1;
    }
  }
}



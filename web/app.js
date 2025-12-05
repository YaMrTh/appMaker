// web/app.js

// ------------- Basic DOM helpers -------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function createElem(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

// ------------- Global state -------------

const state = {
  tags: [],
  currentTagId: null,
  currentSubTagId: null,
  currentSentence: null, // { id, tokens, japaneseSentence, ... }

  lists: {
    vocabulary: { page: 1, pageSize: 20, totalPages: 1 },
    templates: { page: 1, pageSize: 20, totalPages: 1 },
    sentenceLibrary: { page: 1, pageSize: 20, totalPages: 1 },
  },
};

// CRUD / import state
let crudState = { tile: null };
let deleteState = null;
let importState = null;

// ------------- Layout / navigation -------------

const navItems = $$('.nav__item');
const sections = $$('.page-section');
const sidebar = $('#sidebar');
const overlay = $('#overlay');
const menuToggle = $('#menuToggle');

navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const target = item.dataset.target;
    sections.forEach((section) => {
      section.classList.toggle('hidden', section.id !== target);
    });
    navItems.forEach((link) =>
      link.classList.toggle('active', link === item)
    );

    sidebar.classList.remove('sidebar--open');
    closeAllModals();
    overlay.classList.remove('overlay--visible');

    if (target === 'settings') {
      loadSettingsDataOnce();
    }
  });
});

menuToggle.addEventListener('click', () => {
  sidebar.classList.toggle('sidebar--open');
  overlay.classList.add('overlay--visible');
});

function closeAllModals() {
  crudModal.classList.remove('modal--open');
  confirmDeleteModal.classList.remove('modal--open');
  importModal.classList.remove('modal--open');
}

overlay.addEventListener('click', () => {
  sidebar.classList.remove('sidebar--open');
  closeAllModals();
  overlay.classList.remove('overlay--visible');
});

function openModal(modalEl) {
  modalEl.classList.add('modal--open');
  overlay.classList.add('overlay--visible');
}

function closeModal(modalEl) {
  modalEl.classList.remove('modal--open');
  if (!sidebar.classList.contains('sidebar--open')) {
    const anyOpen =
      crudModal.classList.contains('modal--open') ||
      confirmDeleteModal.classList.contains('modal--open') ||
      importModal.classList.contains('modal--open');
    if (!anyOpen) overlay.classList.remove('overlay--visible');
  }
}

// ------------- Settings buttons, modals & elements -------------

// Generator elements
const tagSelect = $('#tagSelect');
const subTagSelect = $('#subTagSelect');
const politenessSelect = $('#politenessSelect');
const difficultySelect = $('#difficultySelect');
const jlptSelect = $('#jlptSelect');
const generateButton = $('#generateButton');
const generatedList = $('#generatedList');
const generatedEmptyState = $('#generatedEmptyState');
const sentenceDisplay = $('#sentenceDisplay');
const favoriteButton = $('#favoriteButton');
const rollButton = $('#rollButton');
const generatedHint = $('#generatedHint');

// Settings buttons
const vocabNewButton = $('#vocabNewButton');
const vocabDeleteButton = $('#vocabDeleteButton');
const vocabImportButton = $('#vocabImportButton');

const templatesNewButton = $('#templatesNewButton');
const templatesDeleteButton = $('#templatesDeleteButton');
const templatesImportButton = $('#templatesImportButton');

const slotsNewButton = $('#slotsNewButton');
const slotsDeleteButton = $('#slotsDeleteButton');
const slotsImportButton = $('#slotsImportButton');

const tagsNewButton = $('#tagsNewButton');
const tagsDeleteButton = $('#tagsDeleteButton');
const tagsImportButton = $('#tagsImportButton');

const libraryNewButton = $('#libraryNewButton');
const libraryDeleteButton = $('#libraryDeleteButton');
const libraryImportButton = $('#libraryImportButton');

// Select-all checkboxes
const vocabSelectAll = $('#vocabSelectAll');
const templatesSelectAll = $('#templatesSelectAll');
const slotsSelectAll = $('#slotsSelectAll');
const tagsMappingSelectAll = $('#tagsMappingSelectAll');
const librarySelectAll = $('#librarySelectAll');

// Modals
const crudModal = $('#crudModal');
const crudForm = $('#crudForm');
const crudTitle = $('#crudTitle');
const crudCancel = $('#crudCancel');
const crudSubmit = $('#crudSubmit');
const crudFormFields = $('#crudFormFields');

const confirmDeleteModal = $('#confirmDeleteModal');
const confirmDeleteMessage = $('#confirmDeleteMessage');
const confirmDeleteCancel = $('#confirmDeleteCancel');
const confirmDeleteYes = $('#confirmDeleteYes');

const importModal = $('#importModal');
const importTitle = $('#importTitle');
const importDropzone = $('#importDropzone');
const importFileInput = $('#importFileInput');
const importInfo = $('#importInfo');
const importCancel = $('#importCancel');
const importSubmit = $('#importSubmit');

crudCancel.addEventListener('click', () => {
  closeModal(crudModal);
});

confirmDeleteCancel.addEventListener('click', () => {
  closeModal(confirmDeleteModal);
});

importCancel.addEventListener('click', () => {
  closeModal(importModal);
});

// ------------- API helpers -------------

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error ? data.error : `POST ${url} failed`;
    throw new Error(msg);
  }
  return data;
}

// ------------- Sentence generator logic -------------

async function loadTags() {
  try {
    const { data } = await apiGet('/api/tags');
    state.tags = data || [];

    const topLevel = state.tags.filter((t) => t.parent_tag_id == null);

    tagSelect.innerHTML = '<option value="">Select tag</option>';
    topLevel.forEach((tag) => {
      const opt = createElem('option', null, tag.name);
      opt.value = String(tag.id);
      tagSelect.appendChild(opt);
    });

    subTagSelect.innerHTML = '<option value="">Select sub tag</option>';
    subTagSelect.disabled = true;
  } catch (err) {
    console.error(err);
    tagSelect.innerHTML =
      '<option value="">Error loading tags (check console)</option>';
  }
}

function updateSubTagSelect(parentId) {
  const parentIdNum = parentId ? Number(parentId) : null;
  const children = state.tags.filter(
    (t) => t.parent_tag_id != null && Number(t.parent_tag_id) === parentIdNum
  );

  subTagSelect.innerHTML = '<option value="">Select sub tag</option>';
  if (!parentIdNum || children.length === 0) {
    subTagSelect.disabled = true;
    return;
  }

  children.forEach((tag) => {
    const opt = createElem('option', null, tag.name);
    opt.value = String(tag.id);
    subTagSelect.appendChild(opt);
  });
  subTagSelect.disabled = false;
}

tagSelect.addEventListener('change', () => {
  state.currentTagId = tagSelect.value || null;
  state.currentSubTagId = null;
  subTagSelect.value = '';
  updateSubTagSelect(state.currentTagId);
});

subTagSelect.addEventListener('change', () => {
  state.currentSubTagId = subTagSelect.value || null;
});

// Render sentence as clickable words
function renderSentenceTokens(tokens) {
  sentenceDisplay.innerHTML = '';
  if (!tokens || tokens.length === 0) {
    const span = createElem('span', 'generated__hint', 'No sentence selected.');
    sentenceDisplay.appendChild(span);
    return;
  }

  tokens.forEach((token) => {
    const wrapper = createElem('div', 'word');
    const button = createElem('button', 'word__button', token.display || '');
    button.type = 'button';
    wrapper.appendChild(button);
    sentenceDisplay.appendChild(wrapper);
  });
}

function addSentenceToHistoryList(sentenceData) {
  if (generatedEmptyState) {
    generatedEmptyState.remove();
  }

  const item = createElem('li', 'generated__item');
  const textSpan = createElem(
    'span',
    'generated__text',
    sentenceData.japaneseSentence
  );

  const useBtn = createElem(
    'button',
    'button button--ghost generated__button',
    'Use'
  );
  useBtn.type = 'button';
  useBtn.addEventListener('click', () => {
    state.currentSentence = sentenceData;
    renderSentenceTokens(sentenceData.tokens);
    updateFavoriteButton();
    sentenceDisplay.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  item.appendChild(textSpan);
  item.appendChild(useBtn);
  generatedList.prepend(item);
}

function updateFavoriteButton() {
  const s = state.currentSentence;
  const isFav = s && s.is_favorite;
  favoriteButton.setAttribute('aria-pressed', isFav ? 'true' : 'false');
  favoriteButton.classList.toggle('button--favorite', !!isFav);
}

// Generate sentence
generateButton.addEventListener('click', async () => {
  const baseTagId = state.currentSubTagId || state.currentTagId;
  if (!baseTagId) {
    alert('Please select at least a Tag.');
    return;
  }

  const body = {
    tagId: Number(baseTagId),
    difficulty: difficultySelect.value || null,
    jlptLevel: jlptSelect.value || null,
    politenessLevel: politenessSelect.value || null,
    displayField: 'furigana',
  };

  generateButton.disabled = true;
  generateButton.textContent = 'Generating...';

  try {
    const data = await apiPost('/api/generate', body);
    const extended = { ...data, is_favorite: 0 };
    state.currentSentence = extended;
    renderSentenceTokens(extended.tokens);
    addSentenceToHistoryList(extended);
    updateFavoriteButton();
    generatedHint.textContent = 'Sentences you generate will appear here.';
  } catch (err) {
    console.error(err);
    alert(err.message);
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = 'Generate';
  }
});

// Roll = generate another sentence
rollButton.addEventListener('click', async () => {
  const baseTagId = state.currentSubTagId || state.currentTagId;
  if (!baseTagId) {
    alert('Pick a Tag before rolling.');
    return;
  }
  try {
    const data = await apiPost('/api/generate', {
      tagId: Number(baseTagId),
      difficulty: difficultySelect.value || null,
      jlptLevel: jlptSelect.value || null,
      politenessLevel: politenessSelect.value || null,
      displayField: 'furigana',
    });
    const extended = { ...data, is_favorite: 0 };
    state.currentSentence = extended;
    renderSentenceTokens(extended.tokens);
    addSentenceToHistoryList(extended);
    updateFavoriteButton();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// Favorite toggle
favoriteButton.addEventListener('click', async () => {
  const sentence = state.currentSentence;
  if (!sentence || !sentence.id) return;

  const newFav = !sentence.is_favorite;

  try {
    await apiPost(`/api/generated-sentences/${sentence.id}/favorite`, {
      isFavorite: newFav,
    });
    sentence.is_favorite = newFav ? 1 : 0;
    updateFavoriteButton();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// ------------- Helpers for settings / CRUD -------------

let settingsLoaded = false;

function ensurePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function openFullList(tileId) {
  const url = new URL(window.location.href);
  url.searchParams.set('fullTile', tileId);
  url.hash = tileId;
  window.open(url.toString(), '_blank');
}

$$('.pagination__full').forEach((btn) => {
  btn.addEventListener('click', () => openFullList(btn.dataset.tile));
});

function getSelectedIds(tableBody) {
  return Array.from(
    tableBody.querySelectorAll('.table__row input[type="checkbox"]:checked')
  )
    .map((cb) => Number(cb.dataset.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function setupSelectAll(selectAllCheckbox, tableBody) {
  if (!selectAllCheckbox) return;
  selectAllCheckbox.addEventListener('change', () => {
    const checked = selectAllCheckbox.checked;
    tableBody
      .querySelectorAll('.table__row input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = checked;
      });
  });
}

// ------------- Settings: Vocabulary -------------

const vocabTopicFilter = $('#vocabTopicFilter');
const vocabSubtopicFilter = $('#vocabSubtopicFilter');
const vocabPolitenessFilter = $('#vocabPolitenessFilter');
const vocabJlptFilter = $('#vocabJlptFilter');
const vocabDifficultyFilter = $('#vocabDifficultyFilter');
const vocabTableBody = $('#vocabTableBody');
const vocabPaginationInfo = $('#vocabPaginationInfo');
const vocabPaginationPage = $('#vocabPaginationPage');

setupSelectAll(vocabSelectAll, vocabTableBody);

async function loadVocabularyPage() {
  if (vocabSelectAll) vocabSelectAll.checked = false;

  const listState = state.lists.vocabulary;
  const page = ensurePositiveInt(listState.page, 1);
  const pageSize = listState.pageSize;

  const params = new URLSearchParams();
  params.set('limit', pageSize);
  params.set('offset', (page - 1) * pageSize);

  if (vocabTopicFilter.value) params.set('topic', vocabTopicFilter.value);
  if (vocabSubtopicFilter.value)
    params.set('subtopic', vocabSubtopicFilter.value);
  if (vocabPolitenessFilter.value)
    params.set('politeness', vocabPolitenessFilter.value);
  if (vocabJlptFilter.value) params.set('jlpt', vocabJlptFilter.value);
  if (vocabDifficultyFilter.value)
    params.set('difficulty', vocabDifficultyFilter.value);

  try {
    const { data, total } = await apiGet(`/api/vocabulary?${params.toString()}`);
    vocabTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No vocabulary found for current filters.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      vocabTableBody.appendChild(row);
    } else {
      data.forEach((row) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.id = row.id;
        c0.appendChild(checkbox);
        tr.dataset.id = row.id;

        const wordText =
          row.furigana || row.kanji || row.romaji || row.meaning || '(empty)';
        const c1 = createElem('div', 'table__cell', wordText);
        const c2 = createElem(
          'div',
          'table__cell',
          `${row.topic || '-'} / ${row.subtopic || '-'}`
        );
        const c3 = createElem('div', 'table__cell', row.difficulty || '-');
        const c4 = createElem('div', 'table__cell', row.updated_at || '-');

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);

        vocabTableBody.appendChild(tr);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    listState.totalPages = totalPages;
    listState.page = Math.min(page, totalPages);

    vocabPaginationInfo.textContent = `Total ${total} vocab item(s) – page size ${pageSize}`;
    vocabPaginationPage.textContent = `${listState.page} / ${totalPages}`;
  } catch (err) {
    console.error(err);
    vocabPaginationInfo.textContent = 'Error loading vocabulary.';
  }
}

$$('.pagination__button[data-tile="vocabulary"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const listState = state.lists.vocabulary;
    if (dir === 'prev') {
      listState.page = Math.max(1, listState.page - 1);
    } else if (dir === 'next') {
      listState.page = Math.min(listState.totalPages, listState.page + 1);
    }
    loadVocabularyPage();
  });
});

[
  vocabTopicFilter,
  vocabSubtopicFilter,
  vocabPolitenessFilter,
  vocabJlptFilter,
  vocabDifficultyFilter,
].forEach((el) =>
  el.addEventListener('change', () => {
    state.lists.vocabulary.page = 1;
    loadVocabularyPage();
  })
);

// ------------- Settings: Sentence templates -------------

const templatesTagFilter = $('#templatesTagFilter');
const templatesSubTagFilter = $('#templatesSubTagFilter');
const templatesTableBody = $('#templatesTableBody');
const templatesPaginationInfo = $('#templatesPaginationInfo');
const templatesPaginationPage = $('#templatesPaginationPage');

setupSelectAll(templatesSelectAll, templatesTableBody);

function fillTagFiltersForSettings() {
  const topLevel = state.tags.filter((t) => t.parent_tag_id == null);

  templatesTagFilter.innerHTML = '<option value="">Tag (any)</option>';
  topLevel.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    templatesTagFilter.appendChild(opt);
  });
  templatesSubTagFilter.innerHTML = '<option value="">Subtag (any)</option>';

  libraryTagFilter.innerHTML = '<option value="">Tag (any)</option>';
  librarySubTagFilter.innerHTML = '<option value="">Sub Tag (any)</option>';
  topLevel.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    libraryTagFilter.appendChild(opt);
  });
}

templatesTagFilter.addEventListener('change', () => {
  const parentId = templatesTagFilter.value || null;
  templatesSubTagFilter.innerHTML = '<option value="">Subtag (any)</option>';

  if (!parentId) {
    state.lists.templates.page = 1;
    loadTemplatesPage();
    return;
  }

  const children = state.tags.filter(
    (t) => t.parent_tag_id != null && Number(t.parent_tag_id) === Number(parentId)
  );
  children.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    templatesSubTagFilter.appendChild(opt);
  });
  state.lists.templates.page = 1;
  loadTemplatesPage();
});

templatesSubTagFilter.addEventListener('change', () => {
  state.lists.templates.page = 1;
  loadTemplatesPage();
});

async function loadTemplatesPage() {
  if (templatesSelectAll) templatesSelectAll.checked = false;

  const listState = state.lists.templates;
  const page = ensurePositiveInt(listState.page, 1);
  const pageSize = listState.pageSize;

  const params = new URLSearchParams();
  params.set('limit', pageSize);
  params.set('offset', (page - 1) * pageSize);

  const tagId = templatesSubTagFilter.value || templatesTagFilter.value;
  if (tagId) params.set('tag_id', tagId);

  try {
    const { data, total } = await apiGet(
      `/api/sentence-templates?${params.toString()}`
    );
    templatesTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No sentence templates for current filters.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      templatesTableBody.appendChild(row);
    } else {
      data.forEach((row) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.id = row.id;
        c0.appendChild(checkbox);
        tr.dataset.id = row.id;

        const c1 = createElem('div', 'table__cell', row.template_pattern || '');
        const c2 = createElem('div', 'table__cell', row.description || '-');
        const c3 = createElem(
          'div',
          'table__cell',
          row.is_active ? 'Yes' : 'No'
        );
        const c4 = createElem('div', 'table__cell', row.updated_at || '-');

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);

        templatesTableBody.appendChild(tr);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    listState.totalPages = totalPages;
    listState.page = Math.min(page, totalPages);

    templatesPaginationInfo.textContent = `Total ${total} template(s) – page size ${pageSize}`;
    templatesPaginationPage.textContent = `${listState.page} / ${totalPages}`;
  } catch (err) {
    console.error(err);
    templatesPaginationInfo.textContent = 'Error loading templates.';
  }
}

$$('.pagination__button[data-tile="sentence-templates"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const listState = state.lists.templates;
    if (dir === 'prev') {
      listState.page = Math.max(1, listState.page - 1);
    } else if (dir === 'next') {
      listState.page = Math.min(listState.totalPages, listState.page + 1);
    }
    loadTemplatesPage();
  });
});

// ------------- Settings: Tags & mapping -------------

const tagsMappingTableBody = $('#tagsMappingTableBody');
const tagsMappingPaginationInfo = $('#tagsMappingPaginationInfo');

setupSelectAll(tagsMappingSelectAll, tagsMappingTableBody);

async function loadTagMappings() {
  if (tagsMappingSelectAll) tagsMappingSelectAll.checked = false;

  try {
    const { data } = await apiGet('/api/tag-mappings');
    tagsMappingTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No tag mappings defined yet.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      tagsMappingTableBody.appendChild(row);
      tagsMappingPaginationInfo.textContent = 'No mappings.';
      return;
    }

    data.forEach((row) => {
      const tr = createElem('div', 'table__row');
      const c0 = createElem('div', 'table__cell');
      const checkbox = createElem('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.id = row.mapping_id;
      c0.appendChild(checkbox);
      tr.dataset.id = row.mapping_id;

      const c1 = createElem('div', 'table__cell', row.tag_name || '');
      const c2 = createElem(
        'div',
        'table__cell',
        row.parent_tag_name || '-'
      );
      const mappedTo = row.vocab_topic
        ? `${row.vocab_topic} / ${row.vocab_subtopic || 'ALL'}`
        : '-';
      const c3 = createElem('div', 'table__cell', mappedTo);
      const c4 = createElem('div', 'table__cell', row.description || '-');

      tr.appendChild(c0);
      tr.appendChild(c1);
      tr.appendChild(c2);
      tr.appendChild(c3);
      tr.appendChild(c4);
      tagsMappingTableBody.appendChild(tr);
    });

    tagsMappingPaginationInfo.textContent = `Loaded ${data.length} mapping(s).`;
  } catch (err) {
    console.error(err);
    tagsMappingPaginationInfo.textContent = 'Error loading mappings.';
  }
}

// ------------- Settings: Sentence library -------------

const libraryTagFilter = $('#libraryTagFilter');
const librarySubTagFilter = $('#librarySubTagFilter');
const libraryPolitenessFilter = $('#libraryPolitenessFilter');
const libraryDifficultyFilter = $('#libraryDifficultyFilter');
const sentenceLibraryTableBody = $('#sentenceLibraryTableBody');
const libraryPaginationInfo = $('#libraryPaginationInfo');
const libraryPaginationPage = $('#libraryPaginationPage');

setupSelectAll(librarySelectAll, sentenceLibraryTableBody);

libraryTagFilter.addEventListener('change', () => {
  const parentId = libraryTagFilter.value || null;
  librarySubTagFilter.innerHTML = '<option value="">Sub Tag (any)</option>';

  if (!parentId) {
    loadSentenceLibraryPage(1);
    return;
  }

  const children = state.tags.filter(
    (t) => t.parent_tag_id != null && Number(t.parent_tag_id) === Number(parentId)
  );
  children.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    librarySubTagFilter.appendChild(opt);
  });

  loadSentenceLibraryPage(1);
});

[
  librarySubTagFilter,
  libraryPolitenessFilter,
  libraryDifficultyFilter,
].forEach((el) =>
  el.addEventListener('change', () => loadSentenceLibraryPage(1))
);

async function loadSentenceLibraryPage(page) {
  if (librarySelectAll) librarySelectAll.checked = false;

  const listState = state.lists.sentenceLibrary;
  listState.page = ensurePositiveInt(page, 1);
  const pageSize = listState.pageSize;

  const params = new URLSearchParams();
  params.set('limit', pageSize);
  params.set('offset', (listState.page - 1) * pageSize);

  const tagId = librarySubTagFilter.value || libraryTagFilter.value;
  if (tagId) params.set('tag_id', tagId);
  if (libraryPolitenessFilter.value)
    params.set('politeness', libraryPolitenessFilter.value);
  if (libraryDifficultyFilter.value)
    params.set('difficulty', libraryDifficultyFilter.value);

  try {
    const { data, total } = await apiGet(
      `/api/generated-sentences?${params.toString()}`
    );
    sentenceLibraryTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No generated sentences yet for these filters.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      sentenceLibraryTableBody.appendChild(row);
    } else {
      data.forEach((row) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.id = row.id;
        c0.appendChild(checkbox);
        tr.dataset.id = row.id;

        const c1 = createElem(
          'div',
          'table__cell',
          row.japanese_sentence || ''
        );
        const c2 = createElem('div', 'table__cell', row.tag_name || '-');
        const c3 = createElem(
          'div',
          'table__cell',
          row.politeness_level || '-'
        );
        const c4 = createElem('div', 'table__cell', row.difficulty || '-');
        const c5 = createElem(
          'div',
          'table__cell',
          row.is_favorite ? '❤️' : '♡'
        );

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);
        tr.appendChild(c5);

        sentenceLibraryTableBody.appendChild(tr);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    listState.totalPages = totalPages;
    listState.page = Math.min(listState.page, totalPages);

    libraryPaginationInfo.textContent = `Total ${total} sentence(s) – page size ${pageSize}`;
    libraryPaginationPage.textContent = `${listState.page} / ${totalPages}`;
  } catch (err) {
    console.error(err);
    libraryPaginationInfo.textContent = 'Error loading sentence library.';
  }
}

$$('.pagination__button[data-tile="sentence-library"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const listState = state.lists.sentenceLibrary;
    if (dir === 'prev') {
      listState.page = Math.max(1, listState.page - 1);
    } else if (dir === 'next') {
      listState.page = Math.min(listState.totalPages, listState.page + 1);
    }
    loadSentenceLibraryPage(listState.page);
  });
});

// ------------- Settings: Slots viewer -------------

const slotsTableBody = $('#slotsTableBody');
const slotsPaginationInfo = $('#slotsPaginationInfo');

setupSelectAll(slotsSelectAll, slotsTableBody);

async function loadSlotsForCurrentTemplatesSample() {
  if (slotsSelectAll) slotsSelectAll.checked = false;

  slotsTableBody.innerHTML = '';

  try {
    const firstTemplatesRes = await apiGet(
      `/api/sentence-templates?limit=5&offset=0`
    );
    const templates = firstTemplatesRes.data || [];
    if (templates.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No templates yet → no slots.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      slotsTableBody.appendChild(row);
      return;
    }

    for (const tmpl of templates) {
      const { data: slots } = await apiGet(
        `/api/template-slots?template_id=${tmpl.id}`
      );
      slots.forEach((slot) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.id = slot.id;
        c0.appendChild(checkbox);
        tr.dataset.id = slot.id;

        const c1 = createElem('div', 'table__cell', slot.slot_name || '');
        const c2 = createElem(
          'div',
          'table__cell',
          slot.grammatical_role || '-'
        );
        const c3 = createElem(
          'div',
          'table__cell',
          slot.part_of_speech || '-'
        );
        const c4 = createElem(
          'div',
          'table__cell',
          tmpl.template_pattern || ''
        );

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);
        slotsTableBody.appendChild(tr);
      });
    }

    slotsPaginationInfo.textContent =
      'Slot data shown for a sample of recent templates.';
  } catch (err) {
    console.error(err);
    const row = createElem('div', 'table__row');
    const cell = createElem('div', 'table__cell', 'Error loading slots.');
    cell.style.gridColumn = '1 / -1';
    row.appendChild(cell);
    slotsTableBody.appendChild(row);
  }
}

// ------------- CSV helper & Import modal logic -------------

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || '').trim();
    });
    rows.push(obj);
  }

  return rows;
}

async function handleImportFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) {
    alert('Please select a .csv file');
    return;
  }

  const text = await file.text();
  const rows = parseCsv(text);

  if (!rows.length) {
    importInfo.textContent = 'No data found in CSV (check headers).';
  } else {
    importInfo.textContent = `Loaded ${rows.length} row(s). Click Import to send them.`;
  }

  importState.rows = rows;
}

importDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  importDropzone.classList.add('dropzone--active');
});

importDropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  importDropzone.classList.remove('dropzone--active');
});

importDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  importDropzone.classList.remove('dropzone--active');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleImportFile(file);
});

importSubmit.addEventListener('click', async () => {
  if (!importState || !importState.tile) {
    alert('No import target selected.');
    return;
  }
  const rows = importState.rows || [];
  if (!rows.length) {
    alert('No rows loaded from CSV.');
    return;
  }

  try {
    switch (importState.tile) {
      case 'vocabulary':
        await apiPost('/api/vocabulary/import', { rows });
        await loadVocabularyPage();
        break;
      case 'templates':
        await apiPost('/api/sentence-templates/import', { rows });
        await loadTemplatesPage();
        break;
      case 'slots':
        await apiPost('/api/template-slots/import', { rows });
        await loadSlotsForCurrentTemplatesSample();
        break;
      case 'tags':
        await apiPost('/api/tag-mappings/import', { rows });
        await loadTagMappings();
        await loadTags();
        fillTagFiltersForSettings();
        break;
      case 'library':
        await apiPost('/api/generated-sentences/import', { rows });
        await loadSentenceLibraryPage(1);
        break;
      default:
        alert('Unknown import tile: ' + importState.tile);
        return;
    }

    closeModal(importModal);
    importState = null;
    importFileInput.value = '';
    importInfo.textContent =
      'Drop a CSV file here or click the button to select one.';
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

function openImportModal(tile, hint) {
  importState = { tile, rows: null };
  importTitle.textContent = `Import CSV – ${hint}`;
  importInfo.textContent =
    'Drop a CSV file here or click the button to select one.';
  importFileInput.value = '';
  openModal(importModal);
}

// Import button wiring
vocabImportButton.addEventListener('click', () =>
  openImportModal(
    'vocabulary',
    'Vocabulary (headers: furigana,meaning,part_of_speech,topic,subtopic,politeness_level,jlpt_level,difficulty,notes,kanji,romaji)'
  )
);

templatesImportButton.addEventListener('click', () =>
  openImportModal(
    'templates',
    'Sentence Templates (headers: template_pattern,description,is_active)'
  )
);

slotsImportButton.addEventListener('click', () =>
  openImportModal(
    'slots',
    'Template Slots (headers: template_id,slot_name,grammatical_role,part_of_speech,is_required,order_index,notes)'
  )
);

tagsImportButton.addEventListener('click', () =>
  openImportModal(
    'tags',
    'Tags & Mapping (headers: tag_name,type,parent_tag_name,vocab_topic,vocab_subtopic,description)'
  )
);

libraryImportButton.addEventListener('click', () =>
  openImportModal(
    'library',
    'Sentence Library (headers: japanese_sentence,english_sentence,tag_name,politeness_level,jlpt_level,difficulty,is_favorite,template_id,source_tag_id)'
  )
);

// ------------- CRUD modal (“New”) logic -------------

function openCrudModalFor(tile) {
  crudState = { tile };
  crudForm.reset();

  switch (tile) {
    case 'vocabulary':
      crudTitle.textContent = 'New vocabulary entry';
      crudFormFields.innerHTML = `
        <div class="form-control">
          <label>Furigana
            <input name="furigana" required />
          </label>
        </div>
        <div class="form-control">
          <label>Meaning
            <input name="meaning" />
          </label>
        </div>
        <div class="form-control">
          <label>Part of speech
            <input name="part_of_speech" placeholder="noun, verb, adjective..." />
          </label>
        </div>
        <div class="form-control">
          <label>Topic
            <input name="topic" />
          </label>
        </div>
        <div class="form-control">
          <label>Subtopic
            <input name="subtopic" />
          </label>
        </div>
        <div class="form-control">
          <label>Difficulty
            <select name="difficulty">
              <option value="">(none)</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>Politeness
            <select name="politeness_level">
              <option value="">(none)</option>
              <option value="plain">Plain</option>
              <option value="polite">Polite</option>
              <option value="honorific">Honorific</option>
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>JLPT
            <select name="jlpt_level">
              <option value="">(none)</option>
              <option value="N5">N5</option>
              <option value="N4">N4</option>
              <option value="N3">N3</option>
              <option value="N2">N2</option>
              <option value="N1">N1</option>
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>Notes
            <textarea name="notes" rows="3"></textarea>
          </label>
        </div>
      `;
      break;

    case 'templates':
      crudTitle.textContent = 'New sentence template';
      crudFormFields.innerHTML = `
        <div class="form-control">
          <label>Template pattern
            <input name="template_pattern" placeholder="{subject} は {object} を {verb}" required />
          </label>
        </div>
        <div class="form-control">
          <label>Description
            <textarea name="description" rows="3"></textarea>
          </label>
        </div>
        <div class="form-control">
          <label>
            <input type="checkbox" name="is_active" checked />
            Active
          </label>
        </div>
      `;
      break;

    case 'slots':
      crudTitle.textContent = 'New template slot';
      crudFormFields.innerHTML = `
        <div class="form-control">
          <label>Template ID
            <input name="template_id" type="number" min="1" required />
          </label>
        </div>
        <div class="form-control">
          <label>Slot name
            <input name="slot_name" placeholder="subject, object, verb..." required />
          </label>
        </div>
        <div class="form-control">
          <label>Grammatical role
            <input name="grammatical_role" placeholder="subject, direct_object..." />
          </label>
        </div>
        <div class="form-control">
          <label>Part of speech
            <input name="part_of_speech" placeholder="noun, verb, adjective..." />
          </label>
        </div>
        <div class="form-control">
          <label>Order index
            <input name="order_index" type="number" value="0" />
          </label>
        </div>
        <div class="form-control">
          <label>
            <input type="checkbox" name="is_required" checked />
            Required
          </label>
        </div>
        <div class="form-control">
          <label>Notes
            <textarea name="notes" rows="3"></textarea>
          </label>
        </div>
      `;
      break;

    case 'tags':
      crudTitle.textContent = 'New tag & mapping';
      const parentOptions = state.tags
        .filter((t) => t.parent_tag_id == null)
        .map((t) => `<option value="${t.id}">${t.name}</option>`)
        .join('');
      crudFormFields.innerHTML = `
        <div class="form-control">
          <label>Tag name
            <input name="name" required />
          </label>
        </div>
        <div class="form-control">
          <label>Type
            <input name="type" placeholder="topic, subtopic, grammar..." />
          </label>
        </div>
        <div class="form-control">
          <label>Parent tag
            <select name="parent_tag_id">
              <option value="">(none)</option>
              ${parentOptions}
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>Description
            <textarea name="description" rows="3"></textarea>
          </label>
        </div>
        <div class="form-control">
          <label>Vocab topic
            <input name="vocab_topic" placeholder="food, travel..." required />
          </label>
        </div>
        <div class="form-control">
          <label>Vocab subtopic
            <input name="vocab_subtopic" placeholder="drinks, noodles..." />
          </label>
        </div>
      `;
      break;

    case 'library':
      crudTitle.textContent = 'New sentence (library)';
      const tagOptions = state.tags
        .map((t) => `<option value="${t.id}">${t.name}</option>`)
        .join('');
      crudFormFields.innerHTML = `
        <div class="form-control">
          <label>Japanese sentence
            <textarea name="japanese_sentence" rows="2" required></textarea>
          </label>
        </div>
        <div class="form-control">
          <label>English sentence
            <textarea name="english_sentence" rows="2"></textarea>
          </label>
        </div>
        <div class="form-control">
          <label>Tag
            <select name="source_tag_id">
              <option value="">(none)</option>
              ${tagOptions}
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>Politeness
            <select name="politeness_level">
              <option value="">(none)</option>
              <option value="plain">Plain</option>
              <option value="polite">Polite</option>
              <option value="honorific">Honorific</option>
              <option value="Mixed">Mixed</option>
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>JLPT
            <select name="jlpt_level">
              <option value="">(none)</option>
              <option value="N5">N5</option>
              <option value="N4">N4</option>
              <option value="N3">N3</option>
              <option value="N2">N2</option>
              <option value="N1">N1</option>
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>Difficulty
            <select name="difficulty">
              <option value="">(none)</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </label>
        </div>
        <div class="form-control">
          <label>
            <input type="checkbox" name="is_favorite" />
            Favorite
          </label>
        </div>
      `;
      break;

    default:
      crudFormFields.innerHTML = '<p>Unknown tile.</p>';
      break;
  }

  openModal(crudModal);
}

// New buttons
vocabNewButton.addEventListener('click', () => openCrudModalFor('vocabulary'));
templatesNewButton.addEventListener('click', () =>
  openCrudModalFor('templates')
);
slotsNewButton.addEventListener('click', () => openCrudModalFor('slots'));
tagsNewButton.addEventListener('click', () => openCrudModalFor('tags'));
libraryNewButton.addEventListener('click', () => openCrudModalFor('library'));

crudForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!crudState || !crudState.tile) return;

  const fd = new FormData(crudForm);
  const body = Object.fromEntries(fd.entries());

  const checkboxNames = ['is_active', 'is_required', 'is_favorite'];
  checkboxNames.forEach((name) => {
    if (crudForm.querySelector(`input[name="${name}"]`)) {
      body[name] = fd.get(name) ? true : false;
    }
  });

  try {
    switch (crudState.tile) {
      case 'vocabulary':
        await apiPost('/api/vocabulary', body);
        await loadVocabularyPage();
        break;
      case 'templates':
        await apiPost('/api/sentence-templates', body);
        await loadTemplatesPage();
        break;
      case 'slots':
        await apiPost('/api/template-slots', body);
        await loadSlotsForCurrentTemplatesSample();
        break;
      case 'tags':
        await apiPost('/api/tags-with-mapping', body);
        await loadTagMappings();
        await loadTags();
        fillTagFiltersForSettings();
        break;
      case 'library':
        await apiPost('/api/generated-sentences', body);
        await loadSentenceLibraryPage(1);
        break;
      default:
        alert('Unknown tile for submit: ' + crudState.tile);
        return;
    }

    closeModal(crudModal);
    crudState = { tile: null };
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// ------------- Delete buttons + confirm modal -------------

function openDeleteConfirm(tile, ids, label) {
  deleteState = { tile, ids };
  confirmDeleteMessage.textContent = `Are you sure you want to delete ${ids.length} ${label} item(s)? This cannot be undone.`;
  openModal(confirmDeleteModal);
}

vocabDeleteButton.addEventListener('click', () => {
  const ids = getSelectedIds(vocabTableBody);
  if (!ids.length) return alert('Select at least one vocabulary row.');
  openDeleteConfirm('vocabulary', ids, 'vocabulary');
});

templatesDeleteButton.addEventListener('click', () => {
  const ids = getSelectedIds(templatesTableBody);
  if (!ids.length) return alert('Select at least one template.');
  openDeleteConfirm('templates', ids, 'template');
});

slotsDeleteButton.addEventListener('click', () => {
  const ids = getSelectedIds(slotsTableBody);
  if (!ids.length) return alert('Select at least one slot.');
  openDeleteConfirm('slots', ids, 'slot');
});

tagsDeleteButton.addEventListener('click', () => {
  const ids = getSelectedIds(tagsMappingTableBody);
  if (!ids.length) return alert('Select at least one tag mapping.');
  openDeleteConfirm('tags', ids, 'mapping');
});

libraryDeleteButton.addEventListener('click', () => {
  const ids = getSelectedIds(sentenceLibraryTableBody);
  if (!ids.length) return alert('Select at least one sentence.');
  openDeleteConfirm('library', ids, 'sentence');
});

confirmDeleteYes.addEventListener('click', async () => {
  if (!deleteState || !deleteState.tile) return;
  const { tile, ids } = deleteState;

  try {
    switch (tile) {
      case 'vocabulary':
        await apiPost('/api/vocabulary/delete-bulk', { ids });
        await loadVocabularyPage();
        break;
      case 'templates':
        await apiPost('/api/sentence-templates/delete-bulk', { ids });
        await loadTemplatesPage();
        break;
      case 'slots':
        await apiPost('/api/template-slots/delete-bulk', { ids });
        await loadSlotsForCurrentTemplatesSample();
        break;
      case 'tags':
        await apiPost('/api/tag-mappings/delete-bulk', { ids });
        await loadTagMappings();
        break;
      case 'library':
        await apiPost('/api/generated-sentences/delete-bulk', { ids });
        await loadSentenceLibraryPage(1);
        break;
      default:
        alert('Unknown delete tile: ' + tile);
        return;
    }
    closeModal(confirmDeleteModal);
    deleteState = null;
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// ------------- Settings: One-time loader -------------

async function loadSettingsDataOnce() {
  if (settingsLoaded) return;
  settingsLoaded = true;

  fillTagFiltersForSettings();

  await Promise.all([
    loadVocabularyPage(),
    loadTemplatesPage(),
    loadTagMappings(),
    loadSentenceLibraryPage(1),
    loadSlotsForCurrentTemplatesSample(),
  ]);
}

// ------------- Full-tile logic for open-in-new-tab -------------

(function handleFullTileMode() {
  const params = new URLSearchParams(window.location.search);
  const fullTile = params.get('fullTile');
  if (!fullTile) return;

  sections.forEach((section) => {
    section.classList.toggle('hidden', section.id !== 'settings');
  });
  navItems.forEach((link) =>
    link.classList.toggle('active', link.dataset.target === 'settings')
  );

  $$('.tile').forEach((tile) => {
    if (tile.id && tile.id !== fullTile) {
      tile.classList.add('hidden');
    } else if (tile.id === fullTile) {
      tile.classList.add('tile--full');
      const pagination = tile.querySelector('.pagination');
      if (pagination) pagination.classList.add('hidden');
    }
  });

  loadSettingsDataOnce();
})();

// ------------- Init on load -------------

window.addEventListener('DOMContentLoaded', async () => {
  await loadTags();
  renderSentenceTokens(null); // initial empty state
});


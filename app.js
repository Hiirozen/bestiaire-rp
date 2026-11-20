const subjectNames = {
  bestiaire: 'Bestiaire',
  potions: 'Potions',
  sortileges: 'Sortilèges',
  histoire: 'Histoire de la magie',
  alchimie: 'Alchimie botanique'
};

const bestiaryMarkup = document.querySelector('#page-content').innerHTML;
const searchInput = document.querySelector('#search-input');
const filters = document.querySelector('#filters');
const reader = document.querySelector('#reader-dialog');
const imageDialog = document.querySelector('#image-dialog');
const editStorageKey = 'havengard-creature-edits-v1';
let activeFilter = 'all';
let activeSection = 'bestiaire';
let searchTerm = '';
let currentCreature = null;

const imagePath = (number) => `public/images/image-${number}.jpg`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}

function cardTemplate(creature) {
  const image = creature.files.length
    ? `<img src="${imagePath(creature.files[0])}" alt="Planche illustrée : ${escapeHtml(creature.title)}" loading="lazy">`
    : '<div class="card-placeholder"><span>✧</span><small>Notice textuelle<br>sans planche associée</small></div>';
  const description = [creature.subtitle, creature.summary || creature.description].filter(Boolean).join(' · ');
  return `<article class="creature-card" tabindex="0" role="button" aria-label="Ouvrir la notice ${escapeHtml(creature.title)}" data-creature="${creature.id}">
    <div class="card-art">${image}<span class="card-kind">${escapeHtml(creature.kind)}</span></div>
    <div class="card-body"><div class="card-heading"><h3>${escapeHtml(creature.title)}</h3><span class="open-mark" aria-hidden="true">↗</span></div>
      <p class="card-latin">${creature.latin ? escapeHtml(creature.latin) : '&nbsp;'}</p><p class="card-description">${escapeHtml(description)}</p></div>
  </article>`;
}

function renderGrid() {
  const results = CREATURES.filter((creature) => {
    const matchesFilter = activeFilter === 'all' || creature.filter === activeFilter;
    const haystack = `${creature.title} ${creature.sourceTitle || ''} ${creature.latin || ''} ${creature.publishedLatin || ''} ${creature.subtitle || ''} ${creature.publishedSubtitle || ''} ${creature.keywords || ''} ${creature.kind} ${creature.description} ${creature.longText || ''} ${JSON.stringify(creature.facts || {})}`.toLocaleLowerCase('fr');
    return matchesFilter && haystack.includes(searchTerm.toLocaleLowerCase('fr'));
  });
  const grid = document.querySelector('#creature-grid');
  const emptyResults = document.querySelector('#empty-results');
  const entryCount = document.querySelector('#entry-count');
  if (!grid || !emptyResults || !entryCount) return;
  grid.innerHTML = results.map(cardTemplate).join('');
  entryCount.textContent = String(results.length);
  emptyResults.hidden = results.length > 0;
}

function renderFactGrid(creature) {
  const labels = [
    ['size', 'Taille'], ['weight', 'Poids'], ['classification', 'Classification'],
    ['origin', 'Origine'], ['habitat', 'Habitat'], ['status', 'Statut']
  ];
  return labels.map(([key, label]) => `<div class="fact"><dt>${label}</dt><dd>${escapeHtml(readFact(creature, key))}</dd></div>`).join('');
}

const factAliases = {
  size: ['size', 'taille'], weight: ['weight', 'poids'], classification: ['classification'],
  origin: ['origin', 'origine'], habitat: ['habitat'], status: ['status', 'statut']
};

const publishedFactAliases = {
  size: 'taille', weight: 'poids', classification: 'classification',
  origin: 'origine', habitat: 'habitat', status: 'statut'
};

function readFact(creature, key) {
  const facts = creature.facts || {};
  for (const alias of factAliases[key] || [key]) {
    if (!Object.prototype.hasOwnProperty.call(facts, alias)) continue;
    const value = String(facts[alias] ?? '').trim();
    return value || 'Non précisé sur la planche';
  }
  return 'Non précisé sur la planche';
}

function editorFactValue(creature, key) {
  const value = readFact(creature, key);
  return /^non\s+(précis|spécifi|renseign)/iu.test(value) ? '' : value;
}

function loadSavedEdits() {
  try {
    const parsed = JSON.parse(localStorage.getItem(editStorageKey) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveEdits(edits) {
  localStorage.setItem(editStorageKey, JSON.stringify(edits));
}

function applySavedEdits() {
  const edits = loadSavedEdits();
  CREATURES.forEach((creature) => {
    const edit = edits[creature.id];
    if (!edit || typeof edit !== 'object') return;
    ['title', 'latin', 'subtitle', 'summary'].forEach((key) => {
      if (typeof edit[key] === 'string') creature[key] = edit[key];
    });
    if (typeof edit.summary !== 'string' && typeof edit.description === 'string') creature.summary = edit.description;
    if (edit.facts && typeof edit.facts === 'object') {
      creature.facts = { ...(creature.facts || {}), ...edit.facts };
      if (creature.publishedFacts) {
        Object.entries(publishedFactAliases).forEach(([key, alias]) => {
          if (Object.prototype.hasOwnProperty.call(creature.publishedFacts, alias)
            && Object.prototype.hasOwnProperty.call(edit.facts, key)) {
            creature.publishedFacts[alias] = edit.facts[key];
          }
        });
      }
    }
  });
}

function populateEditor(creature) {
  const form = document.querySelector('#reader-editor');
  ['title', 'latin', 'subtitle'].forEach((key) => {
    form.elements.namedItem(key).value = creature[key] || '';
  });
  form.elements.namedItem('summary').value = creature.summary || creature.description || '';
  Object.keys(factAliases).forEach((key) => {
    form.elements.namedItem(key).value = editorFactValue(creature, key);
  });
}

function setEditorMode(editing) {
  document.querySelector('#reader-view').hidden = editing;
  document.querySelector('#reader-editor').hidden = !editing;
  document.querySelector('#edit-entry').hidden = editing;
  document.querySelector('#reader-save-status').hidden = true;
  if (editing && currentCreature) {
    document.querySelector('#editor-status').textContent = '';
    populateEditor(currentCreature);
  }
}

function exportSavedEdits() {
  const edits = loadSavedEdits();
  const payload = JSON.stringify({ format: 'havengard-edits-v1', edits }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'havengard-modifications.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importSavedEdits(file) {
  const status = document.querySelector('#editor-status');
  file.text().then((contents) => {
    const payload = JSON.parse(contents);
    if (payload.format !== 'havengard-edits-v1' || !payload.edits || typeof payload.edits !== 'object') {
      throw new Error('Format de sauvegarde invalide.');
    }
    const knownIds = new Set(CREATURES.map((creature) => creature.id));
    const imported = Object.fromEntries(Object.entries(payload.edits).filter(([id, edit]) => knownIds.has(id) && edit && typeof edit === 'object'));
    saveEdits({ ...loadSavedEdits(), ...imported });
    applySavedEdits();
    renderGrid();
    if (currentCreature) {
      currentCreature = CREATURES.find((creature) => creature.id === currentCreature.id);
      populateEditor(currentCreature);
      renderReader(currentCreature);
    }
    status.textContent = 'Sauvegarde importée et enregistrée dans ce navigateur.';
  }).catch(() => {
    status.textContent = 'Impossible de lire ce fichier. Choisis une sauvegarde Havengard au format JSON.';
  });
}

function renderOriginalNotes(creature) {
  const note = creature.longText || '';
  const facts = creature.publishedFacts || {};
  if (!note && !Object.keys(facts).length) return '';
  const labels = { taille:'Taille', poids:'Poids', classification:'Classification', origine:'Origine', habitat:'Habitat', statut:'Statut' };
  const noteHtml = escapeHtml(note.replace(/\\n/g, '\n'))
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  const factsHtml = Object.entries(facts).map(([key, value]) => `<div><dt>${labels[key] || escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  const provenance = [];
  if (creature.publishedLatin && creature.publishedLatin !== creature.latin) provenance.push(`Nom latin conservé : ${creature.publishedLatin}`);
  if (creature.publishedSubtitle && creature.publishedSubtitle !== creature.subtitle) provenance.push(`Appellation conservée : ${creature.publishedSubtitle}`);
  const provenanceHtml = provenance.map((line) => `<p class="source-alias">${escapeHtml(line)}</p>`).join('');
  return `<details class="original-details"><summary>Notes détaillées conservées</summary>${provenanceHtml}${note ? `<div class="original-text">${noteHtml}</div>` : ''}${factsHtml ? `<dl class="original-facts">${factsHtml}</dl>` : ''}</details>`;
}

function renderReader(creature) {
  document.querySelector('#reader-title').textContent = creature.title;
  document.querySelector('#reader-latin').textContent = creature.latin || 'Notice illustrée';
  document.querySelector('#reader-alias').textContent = creature.sourceTitle ? `Autre nom conservé : ${creature.sourceTitle}` : '';
  document.querySelector('#reader-tagline').textContent = creature.subtitle || '';
  document.querySelector('#reader-description').textContent = creature.summary || creature.description || 'Résumé à compléter.';
  document.querySelector('#fact-grid').innerHTML = renderFactGrid(creature);
  document.querySelector('#reader-extra').innerHTML = renderOriginalNotes(creature);
  document.querySelector('#reader-pages').innerHTML = creature.files.length
    ? creature.files.map((number, index) => `<figure><img src="${imagePath(number)}" alt="${escapeHtml(creature.title)} — planche ${index + 1}" data-zoom="${number}"><figcaption>Planche ${index + 1} · image source ${number}</figcaption></figure>`).join('')
    : '<p class="no-pages">Aucune planche correspondante dans le dossier d’images. Les notes de la notice sont conservées ci-dessus.</p>';
}

function openReader(creature) {
  currentCreature = creature;
  renderReader(creature);
  document.querySelector('#reader-save-status').hidden = true;
  setEditorMode(false);
  reader.showModal();
}

function showSubject(section) {
  activeSection = section;
  document.querySelectorAll('.subject-link').forEach((button) => button.classList.toggle('active', button.dataset.section === section));
  document.querySelector('#crumb-current').textContent = subjectNames[section];
  const isBestiary = section === 'bestiaire';
  searchInput.disabled = !isBestiary;
  searchInput.placeholder = isBestiary ? 'Rechercher une créature…' : `Rechercher dans ${subjectNames[section]}…`;
  if (isBestiary) {
    activeFilter = 'all';
    searchTerm = '';
    searchInput.value = '';
    document.querySelector('#page-content').innerHTML = bestiaryMarkup;
    bindBestiaryControls();
    renderGrid();
  } else {
    document.querySelector('#page-content').innerHTML = `<div class="empty-subject"><div class="empty-subject-card"><span class="empty-glyph">${section === 'potions' ? '⚗' : section === 'sortileges' ? '✧' : section === 'histoire' ? '◷' : '❋'}</span><p class="eyebrow" style="justify-content:center">RAYON DE LA BIBLIOTHÈQUE</p><h1>${escapeHtml(subjectNames[section])}</h1><p>Ce rayon est prêt à accueillir ses notes. Le dossier fourni contient uniquement les planches du bestiaire ; aucun document de cette matière n’y figure encore.</p><small>Source actuelle : 50 planches illustrées · Bestiaire RP Light</small></div></div><footer class="page-footer"><span>Archives de Havengard</span><span>Conservé avec soin · Consulté avec prudence</span></footer>`;
  }
}

function bindBestiaryControls() {
  const newGrid = document.querySelector('#creature-grid');
  const newFilters = document.querySelector('#filters');
  const newEmptyResults = document.querySelector('#empty-results');
  if (!newGrid) return;
  newFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter;
    newFilters.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip === button));
    renderGrid();
  });
  newGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-creature]');
    if (card) openReader(CREATURES.find((item) => item.id === card.dataset.creature));
  });
  newGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-creature]');
    if (!card) return;
    event.preventDefault();
    openReader(CREATURES.find((item) => item.id === card.dataset.creature));
  });
}

document.querySelector('#subject-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-section]');
  if (button) showSubject(button.dataset.section);
});

document.addEventListener('input', (event) => {
  if (event.target.id !== 'search-input') return;
  searchTerm = event.target.value.trim();
  if (activeSection === 'bestiaire') renderGrid();
});

document.addEventListener('click', (event) => {
  const image = event.target.closest('[data-zoom]');
  if (!image) return;
  document.querySelector('#zoom-image').src = imagePath(image.dataset.zoom);
  imageDialog.showModal();
});

document.querySelector('.close-reader').addEventListener('click', () => reader.close());
document.querySelector('.close-image').addEventListener('click', () => imageDialog.close());
reader.addEventListener('click', (event) => { if (event.target === reader) reader.close(); });
imageDialog.addEventListener('click', (event) => { if (event.target === imageDialog) imageDialog.close(); });

document.querySelector('#edit-entry').addEventListener('click', () => setEditorMode(true));
document.querySelector('#cancel-edit').addEventListener('click', () => setEditorMode(false));
document.querySelector('#export-edits').addEventListener('click', exportSavedEdits);
document.querySelector('#import-edits').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importSavedEdits(file);
  event.target.value = '';
});
document.querySelector('#reader-editor').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentCreature) return;
  const data = new FormData(event.currentTarget);
  const facts = Object.fromEntries(Object.keys(factAliases).map((key) => [key, String(data.get(key) || '').trim()]));
  const edit = {
    title: String(data.get('title') || '').trim(),
    latin: String(data.get('latin') || '').trim(),
    subtitle: String(data.get('subtitle') || '').trim(),
    summary: String(data.get('summary') || '').trim(),
    facts
  };
  const edits = loadSavedEdits();
  edits[currentCreature.id] = edit;
  try {
    saveEdits(edits);
  } catch {
    document.querySelector('#editor-status').textContent = 'La sauvegarde locale est indisponible dans ce navigateur.';
    return;
  }
  Object.assign(currentCreature, edit);
  currentCreature.facts = { ...(currentCreature.facts || {}), ...facts };
  if (currentCreature.publishedFacts) {
    Object.entries(publishedFactAliases).forEach(([key, alias]) => {
      if (Object.prototype.hasOwnProperty.call(currentCreature.publishedFacts, alias)) {
        currentCreature.publishedFacts[alias] = facts[key];
      }
    });
  }
  renderGrid();
  renderReader(currentCreature);
  setEditorMode(false);
  const saveStatus = document.querySelector('#reader-save-status');
  saveStatus.textContent = 'Modifications enregistrées dans ce navigateur.';
  saveStatus.hidden = false;
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (activeSection !== 'bestiaire') showSubject('bestiaire');
    searchInput.focus();
  }
});

applySavedEdits();
bindBestiaryControls();
renderGrid();

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
const libraryStorageKey = 'havengard-library-edits-v1';
let activeFilter = 'all';
let activeSection = 'bestiaire';
let searchTerm = '';
let currentCreature = null;
let contentEditContext = null;

const imagePath = (number) => `public/images/image-${number}.jpg`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}

function cardTemplate(creature) {
  const image = creature.files.length
    ? `<img src="${imagePath(creature.files[0])}" alt="Planche illustrée : ${escapeHtml(creature.title)}" loading="lazy">`
    : '<div class="card-placeholder"><span>✧</span><small>Notice textuelle<br>sans planche associée</small></div>';
  const description = [creature.subtitle, creature.description].filter(Boolean).join(' · ');
  return `<article class="creature-card" tabindex="0" role="button" aria-label="Ouvrir la notice ${escapeHtml(creature.title)}" data-creature="${creature.id}">
    <div class="card-art">${image}<span class="card-kind">${escapeHtml(creature.kind)}</span></div>
    <div class="card-body"><div class="card-heading"><h3>${escapeHtml(creature.title)}</h3><span class="open-mark" aria-hidden="true">↗</span></div>
      <p class="card-latin">${creature.latin ? escapeHtml(creature.latin) : '&nbsp;'}</p><p class="card-description">${escapeHtml(description)}</p></div>
  </article>`;
}

function updateNavCount(section, count) {
  const button = document.querySelector(`.subject-link[data-section="${section}"]`);
  if (!button) return;
  let badge = button.querySelector('.nav-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-count';
    button.append(badge);
  }
  badge.textContent = String(count);
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
  updateNavCount('bestiaire', CREATURES.length);
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

function normalizeClassification(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s*[-–]\s*/g, '–').replace(/\s+/g, '');
  const match = normalized.match(/^([1-8])x(?:–([1-8])x)?$/);
  if (!match || (match[2] && Number(match[1]) > Number(match[2]))) return '';
  return normalized;
}

function readFact(creature, key) {
  const facts = creature.facts || {};
  for (const alias of factAliases[key] || [key]) {
    if (!Object.prototype.hasOwnProperty.call(facts, alias)) continue;
    const value = String(facts[alias] ?? '').trim();
    if (key === 'classification') return normalizeClassification(value) || 'Non renseignée';
    if (key === 'status') return ['animal', 'esprits', 'être', 'non être'].includes(value.toLocaleLowerCase('fr')) ? value.toLocaleLowerCase('fr') : 'Non renseigné';
    return value || 'Non précisé sur la planche';
  }
  if (key === 'classification') return 'Non renseignée';
  return key === 'status' ? 'Non renseigné' : 'Non précisé sur la planche';
}

function editorFactValue(creature, key) {
  const value = readFact(creature, key);
  if (key === 'classification') return normalizeClassification(value);
  if (key === 'status') return ['animal', 'esprits', 'être', 'non être'].includes(value.toLocaleLowerCase('fr')) ? value.toLocaleLowerCase('fr') : '';
  return /^non\s+(précis|spécifi|renseign)/iu.test(value) ? '' : value;
}

function cleanCreatureCategoryMentions(text) {
  return String(text || '')
    .replace(/\s*classification\s*:\s*[^.\n]*(?:\.)?/giu, ' ')
    .replace(/\s*statut(?:\s+et\s+comportement)?\s*:\s*[^.\n]*(?:\.)?/giu, ' ')
    .replace(/[ \t]{2,}/g, ' ').trim();
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

function loadLibraryState() {
  const empty = { potionEdits: {}, newPotions: [], customCreatures: [], notes: { sortileges: [], histoire: [], alchimie: [] } };
  try {
    const saved = JSON.parse(localStorage.getItem(libraryStorageKey) || '{}');
    return {
      ...empty,
      ...saved,
      potionEdits: saved.potionEdits || {},
      newPotions: Array.isArray(saved.newPotions) ? saved.newPotions : [],
      customCreatures: Array.isArray(saved.customCreatures) ? saved.customCreatures : [],
      notes: { ...empty.notes, ...(saved.notes || {}) }
    };
  } catch {
    return empty;
  }
}

function saveLibraryState(state) {
  localStorage.setItem(libraryStorageKey, JSON.stringify(state));
}

function getPotions() {
  const state = loadLibraryState();
  const edited = POTIONS.map((potion) => ({ ...potion, ...(state.potionEdits[potion.id] || {}) }));
  return [...edited, ...state.newPotions];
}

function getSubjectNotes(section) {
  const state = loadLibraryState();
  const saved = Array.isArray(state.notes[section]) ? state.notes[section] : [];
  const defaults = Array.isArray(SUBJECT_NOTES[section]) ? SUBJECT_NOTES[section] : [];
  const savedById = new Map(saved.map((note) => [note.id, note]));
  const defaultIds = new Set(defaults.map((note) => note.id));
  return [
    ...defaults.map((note) => ({ ...note, ...(savedById.get(note.id) || {}) })),
    ...saved.filter((note) => !defaultIds.has(note.id))
  ];
}

function applySavedEdits() {
  const library = loadLibraryState();
  library.customCreatures.forEach((creature) => {
    if (!CREATURES.some((existing) => existing.id === creature.id)) CREATURES.push(creature);
  });
  CREATURES.forEach((creature) => {
    if (creature.facts) {
      const classification = normalizeClassification(creature.facts.classification);
      if (classification) creature.facts.classification = classification;
      else delete creature.facts.classification;
      delete creature.facts.statut;
      const status = String(creature.facts.status || '').trim().toLocaleLowerCase('fr');
      if (['animal', 'esprits', 'être', 'non être'].includes(status)) creature.facts.status = status;
      else delete creature.facts.status;
    }
    if (creature.publishedFacts) {
      delete creature.publishedFacts.classification;
      delete creature.publishedFacts.status;
      delete creature.publishedFacts.statut;
    }
    if (typeof creature.summary === 'string') creature.summary = cleanCreatureCategoryMentions(creature.summary);
    if (typeof creature.description === 'string') creature.description = cleanCreatureCategoryMentions(creature.description);
  });
  const edits = loadSavedEdits();
  CREATURES.forEach((creature) => {
    const edit = edits[creature.id];
    if (!edit || typeof edit !== 'object') return;
    ['title', 'latin', 'subtitle', 'summary'].forEach((key) => {
      if (typeof edit[key] === 'string') creature[key] = key === 'summary' ? cleanCreatureCategoryMentions(edit[key]) : edit[key];
    });
    if (typeof edit.kind === 'string') creature.kind = edit.kind;
    if (typeof edit.filter === 'string') creature.filter = edit.filter;
    if (typeof edit.summary !== 'string' && typeof edit.description === 'string') creature.summary = cleanCreatureCategoryMentions(edit.description);
    if (edit.facts && typeof edit.facts === 'object') {
      const editedFacts = { ...edit.facts };
      const editedClassification = normalizeClassification(editedFacts.classification);
      if (editedClassification) editedFacts.classification = editedClassification;
      else delete editedFacts.classification;
      delete editedFacts.statut;
      if (Object.prototype.hasOwnProperty.call(editedFacts, 'status')) {
        const editedStatus = String(editedFacts.status || '').trim().toLocaleLowerCase('fr');
        if (['animal', 'esprits', 'être', 'non être'].includes(editedStatus)) editedFacts.status = editedStatus;
        else delete editedFacts.status;
      }
      creature.facts = { ...(creature.facts || {}), ...editedFacts };
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
  form.elements.namedItem('kind').value = creature.kind || '';
  form.elements.namedItem('filter').value = creature.filter || 'terrestre';
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
  const payload = JSON.stringify({ format: 'havengard-library-v2', creatureEdits: loadSavedEdits(), library: loadLibraryState() }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'havengard-sauvegarde.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importSavedEdits(file, status = document.querySelector('#editor-status')) {
  file.text().then((contents) => {
    const payload = JSON.parse(contents);
    if (payload.format === 'havengard-library-v2') {
      saveEdits(payload.creatureEdits && typeof payload.creatureEdits === 'object' ? payload.creatureEdits : {});
      saveLibraryState(payload.library && typeof payload.library === 'object' ? payload.library : loadLibraryState());
    } else if (payload.format === 'havengard-edits-v1' && payload.edits && typeof payload.edits === 'object') {
      const knownIds = new Set(CREATURES.map((creature) => creature.id));
      const imported = Object.fromEntries(Object.entries(payload.edits).filter(([id, edit]) => knownIds.has(id) && edit && typeof edit === 'object'));
      saveEdits({ ...loadSavedEdits(), ...imported });
    } else {
      throw new Error('Format de sauvegarde invalide.');
    }
    applySavedEdits();
    if (activeSection === 'bestiaire') renderGrid();
    else showSubject(activeSection);
    if (currentCreature) {
      currentCreature = CREATURES.find((creature) => creature.id === currentCreature.id);
      if (currentCreature) {
        populateEditor(currentCreature);
        renderReader(currentCreature);
      }
    }
    if (status) status.textContent = 'Sauvegarde importée et enregistrée dans ce navigateur.';
  }).catch(() => {
    if (status) status.textContent = 'Impossible de lire ce fichier. Choisis une sauvegarde Havengard au format JSON.';
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
  const factsHtml = Object.entries(facts).filter(([key]) => key !== 'classification' && key !== 'status' && key !== 'statut').map(([key, value]) => `<div><dt>${labels[key] || escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
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

function renderPotionsPage() {
  const potions = getPotions();
  updateNavCount('potions', potions.length);
  return `<section class="potion-library">
    <div class="potion-page-heading"><div><p class="eyebrow">REGISTRE DES PRÉPARATIONS</p><h1>Potions</h1><p class="intro-copy">Formules, usages et méthodes de préparation conservés dans les archives.</p></div><div class="potion-page-stamp" aria-hidden="true">⚗</div></div>
    <div class="collection-strip"><strong>${potions.length}</strong><span>${potions.length > 1 ? 'recettes' : 'recette'}</span><span class="strip-divider"></span><p>Notes de potions transmises à l’archive</p></div>
    <button class="add-record-button" type="button" data-add-potion>+ Ajouter une potion</button>
    <div class="potion-card-grid">${potions.map(potionCardTemplate).join('')}</div>
    <footer class="page-footer"><span>Archives de Havengard</span><span>Conservé avec soin · Consulté avec prudence</span></footer>
  </section>`;
}

function potionCardTemplate(potion) {
  return `<button class="potion-card" type="button" data-potion="${escapeHtml(potion.id)}" aria-label="Ouvrir la fiche ${escapeHtml(potion.name)}">
    <div class="potion-card-top"><span class="potion-entry-mark" aria-hidden="true">⚗</span><span class="potion-type">${escapeHtml(potion.type)}</span></div>
    <h2>${escapeHtml(potion.name)}</h2>
    <p>${escapeHtml(potion.description)}</p>
    <span class="potion-card-link">Consulter la fiche <span aria-hidden="true">↗</span></span>
  </button>`;
}

function openPotion(potion) {
  const current = getPotions().find((item) => item.id === potion.id) || potion;
  document.querySelector('#potion-reader-content').innerHTML = potionTemplate(current);
  document.querySelector('#potion-dialog').showModal();
}

function potionTemplate(potion) {
  const details = [
    ['Origines', potion.origin],
    ['Ouvrage / source', potion.source],
    ['Utilisation', potion.usage],
    ['Posologie', potion.dosage],
    ['Apparence', potion.appearance],
    ['Couleur', potion.color],
    ['Texture', potion.texture],
    ['Odeur', potion.aroma],
    ['Goût', potion.taste],
    ['Température', potion.temperature],
    ['Contact', potion.contact]
  ].filter(([, value]) => Boolean(value));
  const steps = (potion.preparation || []).map((step) => typeof step === 'string' ? { text: step } : step);
  const functionNote = potion.function ? `<p class="potion-function"><strong>Fonction :</strong> ${escapeHtml(potion.function)}</p>` : '';
  const limitations = potion.limitations ? `<section class="potion-note"><h3>Limites</h3><p>${escapeHtml(potion.limitations)}</p></section>` : '';
  const sideEffects = potion.sideEffects?.length ? `<section class="potion-note potion-caution"><h3>Effets secondaires et précautions</h3><ul>${potion.sideEffects.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';
  const conservation = potion.conservation ? `<section class="potion-note"><h3>Conservation</h3><p>${escapeHtml(potion.conservation)}</p></section>` : '';
  const particularity = potion.particularity ? `<section class="potion-note"><h3>Particularité</h3><p>${escapeHtml(potion.particularity)}</p></section>` : '';
  const testimony = potion.testimony ? `<blockquote class="potion-testimony"><p class="eyebrow">TÉMOIGNAGE</p><p>${escapeHtml(potion.testimony)}</p></blockquote>` : '';
  const history = potion.history ? '<section class="potion-note potion-history"><h3>Histoire et témoignages</h3><p>'+escapeHtml(potion.history)+'</p></section>' : '';
  const plates = (potion.plates || (potion.plate ? [potion.plate] : [])).filter(Boolean);
  const plate = plates.length ? '<section class="potion-plates-section"><h3>Planches originales</h3><div class="potion-original-plates">'+plates.map((src,index) => '<figure class="potion-original-plate"><img src="'+escapeHtml(src)+'" alt="Planche '+String(index+1).padStart(2,'0')+' de la potion '+escapeHtml(potion.name)+'" loading="lazy"><figcaption>Planche '+String(index+1).padStart(2,'0')+' · archive originale</figcaption></figure>').join('')+'</div></section>' : '';
  const variant = potion.variant ? `<aside class="potion-variant"><div><p class="eyebrow">VARIANTE</p><h3>${escapeHtml(potion.variant.name)}</h3><p>${escapeHtml(potion.variant.description)}</p></div><span aria-hidden="true">✦ ✦</span></aside>` : '';
  const incantation = potion.incantation ? `<p class="potion-incantation"><span>Incantation${potion.incantationDuration ? ` · ${escapeHtml(potion.incantationDuration)} s` : ''}</span><strong>${escapeHtml(potion.incantation)}</strong></p>` : '';
  const totalTime = potion.totalTime ? `<p class="potion-total-time">Durée totale : ${escapeHtml(potion.totalTime)}</p>` : '';
  const finishing = potion.finishing ? `<p class="potion-finishing">${escapeHtml(potion.finishing)}</p>` : '';
  const tags = [potion.type, potion.subcategory].filter(Boolean).map((tag) => `<span class="potion-type">${escapeHtml(tag)}</span>`).join(' ');
  return `<article class="potion-sheet">
    <header class="potion-entry-heading"><div><p class="eyebrow">FICHE DE POTION</p><h2>${escapeHtml(potion.name)}</h2><div class="potion-tags">${tags}</div></div><span class="potion-entry-mark" aria-hidden="true">⚗</span></header>
    ${functionNote}<p class="eyebrow potion-section-label">DESCRIPTION</p><p class="potion-summary">${escapeHtml(potion.description)}</p>
    <div class="potion-detail-grid">${details.map(([label, value]) => `<section class="potion-detail"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value)}</p></section>`).join('')}</div>
    <div class="potion-work-grid">
      <section class="potion-section"><h3>Ingrédients</h3><ul class="potion-ingredients">${potion.ingredients.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
      <section class="potion-section"><h3>Préparation</h3><ol class="potion-steps">${steps.map((step) => `<li><span>${escapeHtml(step.text)}</span>${step.duration ? `<small>${escapeHtml(step.duration)} s</small>` : ''}</li>`).join('')}</ol>${incantation}${totalTime}${finishing}</section>
    </div>
    ${history}${limitations}${sideEffects}${conservation}${particularity}${variant}${testimony}${plate}
    <div class="potion-sheet-actions"><button class="edit-button" type="button" data-edit-potion="${escapeHtml(potion.id)}">Modifier cette fiche</button></div>
  </article>`;
}

function fieldInput(label, name, value = '', wide = false) {
  return `<label class="${wide ? 'editor-wide' : ''}">${escapeHtml(label)}<input name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" maxlength="300" /></label>`;
}

function fieldArea(label, name, value = '', wide = true, rows = 3) {
  return `<label class="${wide ? 'editor-wide' : ''}">${escapeHtml(label)}<textarea name="${escapeHtml(name)}" rows="${rows}" maxlength="6000">${escapeHtml(value || '')}</textarea></label>`;
}

function potionFormFields(potion = {}) {
  const ingredients = (potion.ingredients || []).join('\n');
  const preparation = (potion.preparation || []).map((step) => typeof step === 'string' ? step : `${step.text}${step.duration ? ` | ${step.duration}` : ''}`).join('\n');
  const sideEffects = (potion.sideEffects || []).join('\n');
  const plates = (potion.plates || (potion.plate ? [potion.plate] : [])).join('\n');
  return `<div class="editor-grid">
    ${fieldInput('Nom de la potion', 'name', potion.name)}${fieldInput('Type', 'type', potion.type)}
    ${fieldInput('Sous-catégorie', 'subcategory', potion.subcategory)}${fieldInput('Fonction', 'function', potion.function)}
    ${fieldArea('Description', 'description', potion.description)}${fieldInput('Origines', 'origin', potion.origin)}
    ${fieldInput('Ouvrage / source', 'source', potion.source, false)}${fieldArea('Histoire et témoignages', 'history', potion.history, false, 8)}
    ${fieldArea('Utilisation', 'usage', potion.usage, false)}${fieldInput('Posologie', 'dosage', potion.dosage, false)}
    ${fieldArea('Apparence', 'appearance', potion.appearance, false)}${fieldInput('Couleur', 'color', potion.color, false)}
    ${fieldInput('Texture', 'texture', potion.texture, false)}${fieldInput('Odeur', 'aroma', potion.aroma, false)}
    ${fieldInput('Goût', 'taste', potion.taste, false)}${fieldInput('Température', 'temperature', potion.temperature, false)}
    ${fieldInput('Contact', 'contact', potion.contact, false)}${fieldArea('Limites', 'limitations', potion.limitations)}
    ${fieldArea('Ingrédients (un par ligne)', 'ingredients', ingredients, false, 5)}${fieldArea('Préparation (une étape par ligne ; durée facultative : étape | secondes)', 'preparation', preparation, false, 8)}
    ${fieldInput('Incantation', 'incantation', potion.incantation, false)}${fieldInput('Durée de l’incantation (secondes)', 'incantationDuration', potion.incantationDuration, false)}
    ${fieldInput('Durée totale', 'totalTime', potion.totalTime, false)}${fieldInput('Instructions finales', 'finishing', potion.finishing, false)}
    ${fieldArea('Effets secondaires et précautions (un par ligne)', 'sideEffects', sideEffects)}${fieldArea('Conservation', 'conservation', potion.conservation, false)}
    ${fieldArea('Particularité', 'particularity', potion.particularity, false)}${fieldArea('Témoignage', 'testimony', potion.testimony, false)}
    ${fieldArea('Planches originales (URL ou chemin du fichier, une par ligne)', 'plates', plates, false, 5)}
    ${fieldInput('Nom de la variante', 'variantName', potion.variant?.name, false)}${fieldArea('Description de la variante', 'variantDescription', potion.variant?.description, false)}
  </div>`;
}

function openPotionEditor(potion = null) {
  contentEditContext = { kind: 'potion', id: potion?.id || null, isNew: !potion };
  document.querySelector('#content-editor-eyebrow').textContent = 'ÉDITION LOCALE · POTIONS';
  document.querySelector('#content-editor-title').textContent = potion ? `Modifier : ${potion.name}` : 'Ajouter une potion';
  document.querySelector('#content-editor-fields').innerHTML = potionFormFields(potion || {});
  document.querySelector('#content-editor-status').textContent = '';
  document.querySelector('#content-editor-dialog').showModal();
}

function parseLineList(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parsePotionSteps(value) {
  return parseLineList(value).map((line) => {
    const match = line.match(/^(.*?)\s*\|\s*(\d+)\s*(?:s|sec(?:ondes)?)?$/i);
    return match ? { text: match[1].trim(), duration: Number(match[2]) } : line;
  });
}

function noteCardTemplate(section, note) {
  const details = (note.details || []).map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('');
  return `<article class="subject-note-card"><p class="eyebrow">${escapeHtml(note.type || subjectNames[section])}</p><h2>${escapeHtml(note.title)}</h2>${note.summary ? `<p class="subject-note-summary">${escapeHtml(note.summary)}</p>` : ''}${note.content ? `<details class="subject-note-content"><summary>Lire la fiche</summary><div>${escapeHtml(note.content).replace(/\n/g, '<br>')}</div></details>` : ''}${details ? `<dl class="subject-note-details">${details}</dl>` : ''}<button class="quiet-button" type="button" data-edit-note="${escapeHtml(note.id)}" data-category="${escapeHtml(section)}">Modifier cette fiche</button></article>`;
}

function renderNotesPage(section) {
  const notes = getSubjectNotes(section);
  updateNavCount(section, notes.length);
  const labels = { sortileges: 'Sortilèges', histoire: 'Histoire de la magie', alchimie: 'Alchimie botanique' };
  return `<section class="subject-library"><div class="potion-page-heading"><div><p class="eyebrow">REGISTRE DES CONNAISSANCES</p><h1>${escapeHtml(labels[section] || subjectNames[section])}</h1><p class="intro-copy">Chaque note possède sa propre fiche, modifiable à tout moment.</p></div><div class="potion-page-stamp" aria-hidden="true">${section === 'sortileges' ? '✧' : section === 'histoire' ? '◷' : '❋'}</div></div><div class="collection-strip"><strong>${notes.length}</strong><span>${notes.length === 1 ? 'fiche' : 'fiches'}</span><span class="strip-divider"></span><p>Enregistrées dans ce navigateur</p></div><button class="add-record-button" type="button" data-add-note="${escapeHtml(section)}">+ Ajouter une fiche</button>${notes.length ? `<div class="subject-note-grid">${notes.map((note) => noteCardTemplate(section, note)).join('')}</div>` : `<div class="empty-subject-card"><span class="empty-glyph">${section === 'sortileges' ? '✧' : section === 'histoire' ? '◷' : '❋'}</span><h2>Aucune fiche pour le moment</h2><p>Ajoute une note ; tu pourras la modifier ou la compléter ensuite.</p></div>`}<footer class="page-footer"><span>Archives de Havengard</span><span>Conservé avec soin · Consulté avec prudence</span></footer></section>`;
}

function openNoteEditor(section, note = null) {
  contentEditContext = { kind: 'note', section, id: note?.id || null, isNew: !note };
  document.querySelector('#content-editor-eyebrow').textContent = `ÉDITION LOCALE · ${subjectNames[section]}`;
  document.querySelector('#content-editor-title').textContent = note ? `Modifier : ${note.title}` : 'Ajouter une fiche';
  const details = (note?.details || []).map((item) => `${item.label}: ${item.value}`).join('\n');
  document.querySelector('#content-editor-fields').innerHTML = `<div class="editor-grid">${fieldInput('Titre', 'title', note?.title)}${fieldInput('Type ou sous-catégorie', 'type', note?.type)}${fieldArea('Résumé', 'summary', note?.summary)}${fieldArea('Contenu détaillé', 'content', note?.content, true, 8)}${fieldArea('Informations complémentaires (une par ligne, format : Nom : valeur)', 'details', details, true, 5)}</div>`;
  document.querySelector('#content-editor-status').textContent = '';
  document.querySelector('#content-editor-dialog').showModal();
}

function saveContentEditor(form) {
  const context = contentEditContext;
  if (!context) return;
  const data = new FormData(form);
  const value = (key) => String(data.get(key) || '').trim();
  const state = loadLibraryState();
  if (context.kind === 'potion') {
    const name = value('name');
    if (!name) {
      document.querySelector('#content-editor-status').textContent = 'Ajoute un nom à cette potion.';
      return;
    }
    const id = context.id || `custom-potion-${Date.now()}`;
    const potion = {
      id, name, type: value('type'), subcategory: value('subcategory'), function: value('function'),
      description: value('description'), origin: value('origin'), source: value('source'), history: value('history'), usage: value('usage'), dosage: value('dosage'),
      limitations: value('limitations'), appearance: value('appearance'), color: value('color'), texture: value('texture'),
      aroma: value('aroma'), taste: value('taste'), temperature: value('temperature'), contact: value('contact'),
      ingredients: parseLineList(value('ingredients')), preparation: parsePotionSteps(value('preparation')),
      incantation: value('incantation'), incantationDuration: value('incantationDuration') ? Number(value('incantationDuration')) : '',
      totalTime: value('totalTime'), finishing: value('finishing'), sideEffects: parseLineList(value('sideEffects')),
      conservation: value('conservation'), particularity: value('particularity'), testimony: value('testimony'),
      plates: parseLineList(value('plates'))
    };
    if (value('variantName') || value('variantDescription')) potion.variant = { name: value('variantName'), description: value('variantDescription') };
    const newIndex = state.newPotions.findIndex((item) => item.id === id);
    if (newIndex >= 0) state.newPotions[newIndex] = potion;
    else if (context.isNew) state.newPotions.push(potion);
    else state.potionEdits[id] = potion;
    saveLibraryState(state);
    document.querySelector('#content-editor-dialog').close();
    const potionDialog = document.querySelector('#potion-dialog');
    if (potionDialog.open) potionDialog.close();
    showSubject('potions');
    contentEditContext = null;
    return;
  }

  const title = value('title');
  if (!title) {
    document.querySelector('#content-editor-status').textContent = 'Ajoute un titre à cette fiche.';
    return;
  }
  const details = parseLineList(value('details')).map((line) => {
    const separator = line.indexOf(':');
    return separator > 0 ? { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() } : { label: 'Note', value: line };
  });
  const rows = state.notes[context.section] || [];
  const id = context.id || `note-${context.section}-${Date.now()}`;
  const note = { id, title, type: value('type'), summary: value('summary'), content: value('content'), details };
  const noteIndex = rows.findIndex((item) => item.id === id);
  if (noteIndex < 0) rows.push(note);
  else rows[noteIndex] = note;
  state.notes[context.section] = rows;
  saveLibraryState(state);
  document.querySelector('#content-editor-dialog').close();
  showSubject(context.section);
  contentEditContext = null;
}

function startNewCreature() {
  const creature = {
    id: `custom-creature-${Date.now()}`, title: '', sourceTitle: '', latin: '', subtitle: '',
    kind: 'Créature magique', filter: 'terrestre', files: [], description: '', summary: '', facts: {}, keywords: ''
  };
  CREATURES.push(creature);
  currentCreature = creature;
  renderGrid();
  openReader(creature);
  setEditorMode(true);
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
  } else if (section === 'potions') {
    document.querySelector('#page-content').innerHTML = renderPotionsPage();
  } else {
    document.querySelector('#page-content').innerHTML = renderNotesPage(section);
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
document.querySelector('.close-potion').addEventListener('click', () => document.querySelector('#potion-dialog').close());
reader.addEventListener('click', (event) => { if (event.target === reader) reader.close(); });
imageDialog.addEventListener('click', (event) => { if (event.target === imageDialog) imageDialog.close(); });
document.querySelector('#potion-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector('#potion-dialog').addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-potion]');
  if (!button) return;
  const potion = getPotions().find((item) => item.id === button.dataset.editPotion);
  if (potion) openPotionEditor(potion);
});
document.querySelector('#page-content').addEventListener('click', (event) => {
  if (event.target.closest('[data-add-creature]')) {
    startNewCreature();
    return;
  }
  if (event.target.closest('[data-add-potion]')) {
    openPotionEditor();
    return;
  }
  const addNote = event.target.closest('[data-add-note]');
  if (addNote) {
    openNoteEditor(addNote.dataset.addNote);
    return;
  }
  const editNote = event.target.closest('[data-edit-note]');
  if (editNote) {
    const section = editNote.dataset.category;
    const note = getSubjectNotes(section).find((item) => item.id === editNote.dataset.editNote);
    if (note) openNoteEditor(section, note);
    return;
  }
  const card = event.target.closest('[data-potion]');
  if (!card) return;
  const potion = getPotions().find((item) => item.id === card.dataset.potion);
  if (potion) openPotion(potion);
});

document.querySelector('#edit-entry').addEventListener('click', () => setEditorMode(true));
document.querySelector('#cancel-edit').addEventListener('click', () => {
  const alreadySaved = currentCreature && loadLibraryState().customCreatures.some((creature) => creature.id === currentCreature.id);
  if (currentCreature?.id.startsWith('custom-creature-') && !alreadySaved && !loadSavedEdits()[currentCreature.id]) {
    CREATURES.splice(CREATURES.indexOf(currentCreature), 1);
    renderGrid();
  }
  setEditorMode(false);
});
document.querySelector('#export-edits').addEventListener('click', exportSavedEdits);
document.querySelector('#import-edits').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importSavedEdits(file);
  event.target.value = '';
});
document.querySelector('.close-content-editor').addEventListener('click', () => document.querySelector('#content-editor-dialog').close());
document.querySelector('#cancel-content-edit').addEventListener('click', () => document.querySelector('#content-editor-dialog').close());
document.querySelector('#export-library').addEventListener('click', exportSavedEdits);
document.querySelector('#import-library').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importSavedEdits(file, document.querySelector('#content-editor-status'));
  event.target.value = '';
});
document.querySelector('#content-editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveContentEditor(event.currentTarget);
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
    kind: String(data.get('kind') || '').trim(),
    filter: String(data.get('filter') || 'terrestre'),
    facts
  };
  const edits = loadSavedEdits();
  edits[currentCreature.id] = edit;
  try {
    saveEdits(edits);
    if (currentCreature.id.startsWith('custom-creature-')) {
      const library = loadLibraryState();
      const updated = { ...currentCreature, ...edit, facts: { ...(currentCreature.facts || {}), ...facts } };
      const index = library.customCreatures.findIndex((creature) => creature.id === currentCreature.id);
      if (index < 0) library.customCreatures.push(updated);
      else library.customCreatures[index] = updated;
      saveLibraryState(library);
    }
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

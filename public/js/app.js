/* ═══════════════════════════════════════════════════
   Fresh Computer Test — Frontend Logic
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────
  const form          = document.getElementById('check-form');
  const zipInput      = document.getElementById('zip-file');
  const fileDrop      = document.getElementById('file-drop');
  const browseBtn     = document.getElementById('browse-btn');
  const fileSelected  = document.getElementById('file-selected');
  const fileName      = document.getElementById('file-name');
  const removeFileBtn = document.getElementById('remove-file');
  const submitBtn     = document.getElementById('submit-btn');
  const btnText       = submitBtn.querySelector('.btn__text');
  const btnLoader     = submitBtn.querySelector('.btn__loader');

  const reportSection = document.getElementById('report-section');
  const statusBanner  = document.getElementById('status-banner');
  const statusIcon    = document.getElementById('status-icon');
  const statusLabel   = document.getElementById('status-label');
  const goodItems     = document.getElementById('good-items');
  const problemItems  = document.getElementById('problem-items');
  const warningItems  = document.getElementById('warning-items');
  const suggestionItems = document.getElementById('suggestion-items');
  const fileTreeList  = document.getElementById('file-tree-list');
  const recheckBtn    = document.getElementById('recheck-btn');

  const listGood       = document.getElementById('list-good');
  const listProblems   = document.getElementById('list-problems');
  const listWarnings   = document.getElementById('list-warnings');
  const listSuggestions = document.getElementById('list-suggestions');

  // ── File drop / browse ────────────────────────────
  browseBtn.addEventListener('click', () => zipInput.click());
  fileDrop.addEventListener('click', (e) => {
    if (e.target === fileDrop || e.target.closest('.file-drop__content')) {
      zipInput.click();
    }
  });

  zipInput.addEventListener('change', () => {
    if (zipInput.files.length) showSelectedFile(zipInput.files[0].name);
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    zipInput.value = '';
    hideSelectedFile();
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(evt =>
    fileDrop.addEventListener(evt, (e) => { e.preventDefault(); fileDrop.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    fileDrop.addEventListener(evt, (e) => { e.preventDefault(); fileDrop.classList.remove('drag-over'); })
  );
  fileDrop.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length && files[0].name.endsWith('.zip')) {
      zipInput.files = files;
      showSelectedFile(files[0].name);
    }
  });

  function showSelectedFile(name) {
    fileName.textContent = name;
    fileSelected.hidden = false;
    fileDrop.querySelector('.file-drop__content').hidden = true;
  }

  function hideSelectedFile() {
    fileSelected.hidden = true;
    fileDrop.querySelector('.file-drop__content').hidden = false;
  }

  // ── Form submission ───────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // ── Client-side validation ──────────────────────
    if (!zipInput.files.length) {
      showFieldError('field-zip', 'Please select a ZIP file.');
      return;
    }
    const lang = document.getElementById('language');
    if (!lang.value) {
      showFieldError('field-language', 'Please select a programming language.');
      return;
    }
    const runCmd = document.getElementById('run-cmd');
    if (!runCmd.value.trim()) {
      showFieldError('field-run', 'Please enter a run command.');
      return;
    }
    clearFieldErrors();

    // Show loading state
    btnText.hidden = true;
    btnLoader.hidden = false;
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append('zip', zipInput.files[0]);
    formData.append('language', document.getElementById('language').value);
    formData.append('setupCmd', document.getElementById('setup-cmd').value);
    formData.append('runCmd', document.getElementById('run-cmd').value);
    formData.append('expectedResult', document.getElementById('expected-result').value);

    try {
      const res = await fetch('/api/check', { method: 'POST', body: formData });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const report = await res.json();
      renderReport(report);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btnText.hidden = false;
      btnLoader.hidden = true;
      submitBtn.disabled = false;
    }
  });

  // ── Render report ─────────────────────────────────
  function renderReport(report) {
    // Status banner
    statusBanner.className = 'status-banner';
    if (report.status === 'Passed') {
      statusBanner.classList.add('status-banner--passed');
      statusIcon.textContent = '✅';
    } else if (report.status === 'Mostly Okay') {
      statusBanner.classList.add('status-banner--okay');
      statusIcon.textContent = '⚠️';
    } else {
      statusBanner.classList.add('status-banner--attention');
      statusIcon.textContent = '🚨';
    }
    statusLabel.textContent = report.status;

    // Lists
    fillList(goodItems, report.good);
    fillList(problemItems, report.problems);
    fillList(warningItems, report.warnings);
    fillList(suggestionItems, report.suggestions);

    // Toggle empty lists
    toggleEmpty(listGood, report.good);
    toggleEmpty(listProblems, report.problems);
    toggleEmpty(listWarnings, report.warnings);
    toggleEmpty(listSuggestions, report.suggestions);

    // File tree
    fileTreeList.innerHTML = '';
    (report.files || []).forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      fileTreeList.appendChild(li);
    });

    // Show report, scroll to it
    reportSection.hidden = false;
    // Re-trigger animation
    reportSection.style.animation = 'none';
    reportSection.offsetHeight; // reflow
    reportSection.style.animation = '';
    reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fillList(ul, items) {
    ul.innerHTML = '';
    (items || []).forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    });
  }

  function toggleEmpty(container, items) {
    if (!items || items.length === 0) {
      container.classList.add('is-empty');
    } else {
      container.classList.remove('is-empty');
    }
  }

  // ── Recheck button ───────────────────────────────
  recheckBtn.addEventListener('click', () => {
    reportSection.hidden = true;
    form.reset();
    hideSelectedFile();
    clearFieldErrors();
    document.getElementById('hero').scrollIntoView({ behavior: 'smooth' });
  });

  // ── Inline validation helpers ───────────────────
  function showFieldError(fieldId, message) {
    clearFieldErrors();
    const field = document.getElementById(fieldId);
    if (!field) return;
    const err = document.createElement('p');
    err.className = 'field__error';
    err.textContent = message;
    field.appendChild(err);
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearFieldErrors() {
    document.querySelectorAll('.field__error').forEach(el => el.remove());
  }
})();

/* ═══════════════════════════════════════════════════
   Fresh Computer Test — Frontend Logic (with Auth)
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Auth check: redirect to login if not logged in ──
  async function checkAuth() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) {
        window.location.href = '/login.html';
        return null;
      }
      const user = await res.json();
      document.getElementById('navbar-user').textContent = `👤 ${user.username}`;
      return user;
    } catch {
      window.location.href = '/login.html';
      return null;
    }
  }

  // Run auth check immediately
  checkAuth().then(user => {
    if (user) loadHistory();
  });

  // ── Logout ────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

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
  const execStatusBadge = document.getElementById('execution-status-badge');
  const execOutput    = document.getElementById('execution-output');

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

  let uploadFiles = [];

  zipInput.addEventListener('change', () => {
    uploadFiles = Array.from(zipInput.files)
      .map(f => {
        let relativePath = f.webkitRelativePath || f.name;
        // Strip top-level directory
        const parts = relativePath.split('/');
        if (parts.length > 1) {
          parts.shift();
          relativePath = parts.join('/');
        }
        return { file: f, path: relativePath };
      })
      .filter(f => {
        // Ignore large/useless dependency folders
        const lowerPath = f.path.toLowerCase();
        return !lowerPath.includes('node_modules/') &&
               !lowerPath.includes('.git/') &&
               !lowerPath.includes('venv/') &&
               !lowerPath.includes('.venv/');
      });
    updateFileUI();
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    zipInput.value = '';
    uploadFiles = [];
    updateFileUI();
  });

  ['dragenter', 'dragover'].forEach(evt =>
    fileDrop.addEventListener(evt, (e) => { e.preventDefault(); fileDrop.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    fileDrop.addEventListener(evt, (e) => { e.preventDefault(); fileDrop.classList.remove('drag-over'); })
  );
  
  fileDrop.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadFiles = [];
    const items = e.dataTransfer.items;
    
    if (items) {
      // Async folder parsing
      const promises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i].webkitGetAsEntry();
        if (item) promises.push(traverseFileTree(item));
      }
      await Promise.all(promises);

      // Strip top-level directory if all files share it
      if (uploadFiles.length > 0) {
        const firstSlash = uploadFiles[0].path.indexOf('/');
        if (firstSlash !== -1) {
          const prefix = uploadFiles[0].path.slice(0, firstSlash + 1);
          const allShare = uploadFiles.every(f => f.path.startsWith(prefix));
          if (allShare) {
            uploadFiles.forEach(f => f.path = f.path.slice(prefix.length));
          }
        }
      }
    } else {
      uploadFiles = Array.from(e.dataTransfer.files).map(f => ({ file: f, path: f.name }));
    }
    updateFileUI();
  });

  async function traverseFileTree(item, path = '') {
    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'venv' || item.name === '.venv' || item.name === '.mypy_cache') {
      return; // Skip these entirely
    }

    if (item.isFile) {
      const file = await new Promise(resolve => item.file(resolve));
      uploadFiles.push({ file, path: path + file.name });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      const entries = [];
      const readAllEntries = () => new Promise(resolve => {
        const read = () => {
          dirReader.readEntries(results => {
            if (!results.length) resolve();
            else {
              entries.push(...results);
              read();
            }
          });
        };
        read();
      });
      await readAllEntries();
      
      for (let i = 0; i < entries.length; i++) {
        await traverseFileTree(entries[i], path + item.name + '/');
      }
    }
  }

  function updateFileUI() {
    if (uploadFiles.length === 0) {
      fileSelected.hidden = true;
      fileDrop.querySelector('.file-drop__content').hidden = false;
    } else {
      fileName.textContent = uploadFiles.length === 1 ? uploadFiles[0].file.name : uploadFiles.length + " files selected";
      fileSelected.hidden = false;
      fileDrop.querySelector('.file-drop__content').hidden = true;
    }
  }

  async function createZipFromFiles(filesList) {
    const zip = new JSZip();
    for (let i = 0; i < filesList.length; i++) {
      zip.file(filesList[i].path, filesList[i].file);
    }
    return await zip.generateAsync({ type: 'blob' });
  }

  // ── Form submission ───────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (uploadFiles.length === 0) {
      showFieldError('field-zip', 'Please select files or a folder.');
      return;
    }
    const projectNameField = document.getElementById('project-name');
    if (!projectNameField.value.trim()) {
      showFieldError('field-project-name', 'Please enter a project name.');
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

    btnText.hidden = true;
    btnLoader.hidden = false;
    submitBtn.disabled = true;
    
    // Reset output UI early for streaming
    reportSection.hidden = false;
    statusBanner.className = 'status-banner status-banner--okay';
    statusIcon.textContent = '⏳';
    statusLabel.textContent = 'Uploading & Analyzing...';
    execStatusBadge.textContent = 'Pending';
    execStatusBadge.style.color = '#fff';
    execOutput.textContent = 'Waiting for Docker...';
    execOutput.style.color = '#fff';

    try {
      let zipBlob;
      if (uploadFiles.length === 1 && uploadFiles[0].file.name.endsWith('.zip')) {
        zipBlob = uploadFiles[0].file;
      } else {
        btnLoader.innerHTML = '<span class="spinner"></span> Zipping folder...';
        zipBlob = await createZipFromFiles(uploadFiles);
        btnLoader.innerHTML = '<span class="spinner"></span> Running in Docker...';
      }

      const formData = new FormData();
      formData.append('zip', zipBlob, 'project.zip');
      formData.append('projectName', document.getElementById('project-name').value);
      formData.append('language', document.getElementById('language').value);
      formData.append('setupCmd', document.getElementById('setup-cmd').value);
      formData.append('runCmd', document.getElementById('run-cmd').value);
      formData.append('expectedResult', document.getElementById('expected-result').value);

      const res = await fetch('/api/check', { method: 'POST', body: formData });

      if (res.status === 401) {
        window.location.href = '/login.html';
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const reportId = data.id;

      // Start SSE stream
      execOutput.textContent = '';
      const eventSource = new EventSource(`/api/stream/${reportId}`);

      eventSource.addEventListener('status', (e) => {
        const payload = JSON.parse(e.data);
        statusLabel.textContent = payload;
      });

      eventSource.addEventListener('stdout', (e) => {
        execOutput.textContent += JSON.parse(e.data);
      });

      eventSource.addEventListener('stderr', (e) => {
        execOutput.textContent += JSON.parse(e.data);
      });

      eventSource.addEventListener('error', (e) => {
        console.error('Stream error:', JSON.parse(e.data));
      });

      eventSource.addEventListener('done', async () => {
        eventSource.close();
        
        // Fetch the completed report and render full UI
        const finalRes = await fetch(`/api/reports/${reportId}`);
        const finalReport = await finalRes.json();
        renderReport(finalReport);
        loadHistory();
        
        btnText.hidden = false;
        btnLoader.hidden = true;
        submitBtn.disabled = false;
      });
      
    } catch (err) {
      alert('Error: ' + err.message);
      btnText.hidden = false;
      btnLoader.hidden = true;
      submitBtn.disabled = false;
      reportSection.hidden = true;
    }
  });

  // ── Render report ─────────────────────────────────
  function renderReport(report) {
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

    fillList(goodItems, report.good);
    fillList(problemItems, report.problems);
    fillList(warningItems, report.warnings);
    fillList(suggestionItems, report.suggestions);

    toggleEmpty(listGood, report.good);
    toggleEmpty(listProblems, report.problems);
    toggleEmpty(listWarnings, report.warnings);
    toggleEmpty(listSuggestions, report.suggestions);

    fileTreeList.innerHTML = '';
    (report.files || []).forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      
      if (report.fileContents && report.fileContents[f]) {
        li.style.cursor = 'pointer';
        li.style.textDecoration = 'underline';
        li.style.color = '#fff';
        li.addEventListener('click', () => {
          showCodeModal(f, report.fileContents[f]);
        });
      }
      
      fileTreeList.appendChild(li);
    });

    if (report.executionStatus) {
      execStatusBadge.textContent = report.executionStatus;
      execStatusBadge.style.color = report.executionStatus === 'Passed' ? '#00ff00' : '#ff4444';
      execOutput.textContent = report.executionOutput;
      // Change color based on success
      execOutput.style.color = report.executionStatus === 'Passed' ? '#00ff00' : '#ff4444';
    } else {
      execStatusBadge.textContent = 'Not Run';
      execOutput.textContent = 'No execution data available.';
    }

    reportSection.hidden = false;
    reportSection.style.animation = 'none';
    reportSection.offsetHeight;
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
    container.classList.toggle('is-empty', !items || items.length === 0);
  }

  // ── Recheck ───────────────────────────────────────
  recheckBtn.addEventListener('click', () => {
    reportSection.hidden = true;
    form.reset();
    uploadFiles = [];
    updateFileUI();
    clearFieldErrors();
    document.getElementById('hero').scrollIntoView({ behavior: 'smooth' });
  });

  // ── History ───────────────────────────────────────
  async function loadHistory() {
    try {
      const res = await fetch('/api/reports?limit=10');
      if (!res.ok) return;

      const reports = await res.json();
      const listEl = document.getElementById('history-list');
      const emptyEl = document.getElementById('history-empty');

      if (reports.length === 0) {
        emptyEl.hidden = false;
        listEl.innerHTML = '';
        return;
      }

      emptyEl.hidden = true;
      listEl.innerHTML = reports.map(r => {
        const statusClass =
          r.status === 'Passed' ? 'history-item--passed' :
          r.status === 'Mostly Okay' ? 'history-item--okay' :
          'history-item--attention';

        const statusEmoji =
          r.status === 'Passed' ? '✅' :
          r.status === 'Mostly Okay' ? '⚠️' : '🚨';

        const date = new Date(r.createdAt + 'Z').toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });

        return `
          <div class="history-item ${statusClass}" data-id="${r.id}">
            <span class="history-item__status">${statusEmoji}</span>
            <div class="history-item__info">
              <span class="history-item__name">${escapeHtml(r.projectName)}</span>
              <span class="history-item__meta">${r.language} · ${date}</span>
            </div>
            <span class="history-item__badge">${r.status}</span>
            <button type="button" class="history-item__delete" data-id="${r.id}" title="Delete scan">&times;</button>
          </div>
        `;
      }).join('');
    } catch {
      // Silently fail — history is a nice-to-have
    }
  }

  // Handle history item clicks
  document.getElementById('history-list').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.history-item__delete');
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.getAttribute('data-id');
      if (confirm('Are you sure you want to delete this scan?')) {
        try {
          await fetch(`/api/reports/${id}`, { method: 'DELETE' });
          loadHistory();
        } catch (err) {
          alert('Failed to delete scan.');
        }
      }
      return;
    }

    const item = e.target.closest('.history-item');
    if (item) {
      const id = item.getAttribute('data-id');
      try {
        const res = await fetch(`/api/reports/${id}`);
        if (res.ok) {
          const report = await res.json();
          renderReport(report);
        }
      } catch (err) {
        alert('Failed to load scan.');
      }
    }
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Code Modal ────────────────────────────────────
  const codeModal = document.getElementById('code-modal');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCloseBtn = document.getElementById('modal-close');
  const modalTitle = document.getElementById('modal-title');
  const modalCode = document.getElementById('modal-code');

  function showCodeModal(filename, content) {
    modalTitle.textContent = filename;
    
    // Determine Prism language class
    const ext = filename.split('.').pop().toLowerCase();
    let langClass = 'language-none';
    if (ext === 'js') langClass = 'language-javascript';
    else if (ext === 'py') langClass = 'language-python';
    else if (ext === 'java') langClass = 'language-java';
    else if (ext === 'html') langClass = 'language-html';
    else if (ext === 'css') langClass = 'language-css';
    else if (ext === 'json') langClass = 'language-json';

    modalCode.className = langClass;
    modalCode.textContent = content;
    
    // Re-highlight if Prism is loaded
    if (window.Prism) {
      Prism.highlightElement(modalCode);
    }
    
    codeModal.hidden = false;
  }

  function hideCodeModal() {
    codeModal.hidden = true;
  }

  modalCloseBtn.addEventListener('click', hideCodeModal);
  modalOverlay.addEventListener('click', hideCodeModal);

  // ── Validation helpers ────────────────────────────
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

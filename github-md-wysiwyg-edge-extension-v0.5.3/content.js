(() => {
  const EDITOR_STATE = new WeakMap();
  const STORAGE_KEY = 'ghw_mode';
  const WIDE_STORAGE_KEY = 'ghw_wide_layout';
  let preferredMode = 'write';
  let preferredWide = true;

  init();

  async function init() {
    preferredMode = await loadMode();
    preferredWide = await loadWideMode();
    ensureWideToggle();
    applyWideMode(preferredWide);
    scan();
    const mo = new MutationObserver(debounce(scan, 150));
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', debounce(() => { if (preferredWide) markWideTargets(); }, 120));
  }

  async function loadMode() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result?.[STORAGE_KEY] === 'wysiwyg' ? 'wysiwyg' : 'write';
    } catch {
      return 'write';
    }
  }

  function saveMode(mode) {
    try { chrome.storage.local.set({ [STORAGE_KEY]: mode }); } catch {}
  }

  async function loadWideMode() {
    try {
      const result = await chrome.storage.local.get(WIDE_STORAGE_KEY);
      return result?.[WIDE_STORAGE_KEY] !== false;
    } catch {
      return true;
    }
  }

  function saveWideMode(enabled) {
    try { chrome.storage.local.set({ [WIDE_STORAGE_KEY]: enabled }); } catch {}
  }



  function ensureWideToggle() {
    let btn = document.querySelector('.ghw-wide-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghw-wide-toggle';
      btn.addEventListener('click', () => {
        preferredWide = !document.body.classList.contains('ghw-wide-layout');
        applyWideMode(preferredWide);
        saveWideMode(preferredWide);
      });
      document.documentElement.appendChild(btn);
    }
    refreshWideToggleLabel(btn);
  }

  function applyWideMode(enabled) {
    document.body.classList.toggle('ghw-wide-layout', !!enabled);
    markWideTargets();
    const btn = document.querySelector('.ghw-wide-toggle');
    if (btn) refreshWideToggleLabel(btn);
  }

  function isWideEligiblePage() {
    const path = location.pathname;
    return /\/issues(\/|$)|\/pull\/(\d+|new)|\/discussions(\/|$)/.test(path);
  }

  function clearWideTargets() {
    document.querySelectorAll('[data-ghw-wide-target="1"]').forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      const prevMax = el.dataset.ghwPrevMaxWidth;
      const prevWidth = el.dataset.ghwPrevWidth;
      const prevMargin = el.dataset.ghwPrevMarginInline;
      const prevPaddingL = el.dataset.ghwPrevPaddingLeft;
      const prevPaddingR = el.dataset.ghwPrevPaddingRight;
      el.style.maxWidth = prevMax || '';
      el.style.width = prevWidth || '';
      el.style.marginInline = prevMargin || '';
      el.style.paddingLeft = prevPaddingL || '';
      el.style.paddingRight = prevPaddingR || '';
      delete el.dataset.ghwWideTarget;
      delete el.dataset.ghwPrevMaxWidth;
      delete el.dataset.ghwPrevWidth;
      delete el.dataset.ghwPrevMarginInline;
      delete el.dataset.ghwPrevPaddingLeft;
      delete el.dataset.ghwPrevPaddingRight;
    });
  }

  function markWideTargets() {
    clearWideTargets();
    if (!preferredWide || !isWideEligiblePage()) return;

    const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.application-main');
    if (!main) return;

    const vp = window.innerWidth || document.documentElement.clientWidth || 1600;
    const candidates = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);

    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest('.ghw-root') || el.classList.contains('ghw-wide-toggle')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 720 || rect.width > vp * 0.96 || rect.height < 80) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || cs.display === 'contents' || cs.position === 'fixed') continue;
      if (cs.maxWidth === 'none' && !/auto/.test(cs.marginLeft + ' ' + cs.marginRight)) continue;
      const maxW = parseFloat(cs.maxWidth);
      const hasCap = Number.isFinite(maxW) && maxW > 0 && maxW < vp * 0.95;
      const centered = cs.marginLeft === 'auto' || cs.marginRight === 'auto';
      const classText = (el.className || '').toString();
      const roleText = `${el.id || ''} ${classText}`.toLowerCase();
      let score = 0;
      if (hasCap) score += 6;
      if (centered) score += 3;
      if (/container|layout|content|main|discussion|issue|pull/.test(roleText)) score += 4;
      score += Math.min(6, rect.width / 250);
      candidates.push({ el, rect, score });
    }

    candidates.sort((a, b) => b.score - a.score || a.rect.top - b.rect.top);
    const picked = [];
    for (const item of candidates) {
      if (picked.some(p => p === item.el || p.contains(item.el) || item.el.contains(p))) continue;
      picked.push(item.el);
      if (picked.length >= 4) break;
    }

    picked.forEach((el, i) => {
      el.dataset.ghwWideTarget = '1';
      el.dataset.ghwPrevMaxWidth = el.style.maxWidth || '';
      el.dataset.ghwPrevWidth = el.style.width || '';
      el.dataset.ghwPrevMarginInline = el.style.marginInline || '';
      el.dataset.ghwPrevPaddingLeft = el.style.paddingLeft || '';
      el.dataset.ghwPrevPaddingRight = el.style.paddingRight || '';
      el.style.maxWidth = i === 0 ? 'min(98vw, 1920px)' : 'none';
      el.style.width = i === 0 ? 'min(98vw, 1920px)' : 'auto';
      el.style.marginInline = 'auto';
      if (i <= 1) {
        el.style.paddingLeft = '16px';
        el.style.paddingRight = '16px';
      }
    });
  }


  function refreshWideToggleLabel(btn) {
    const active = document.body.classList.contains('ghw-wide-layout');
    btn.classList.toggle('is-active', active);
    btn.textContent = active ? '寬版閱讀：開' : '寬版閱讀：關';
    btn.title = active ? '關閉 GitHub issue 寬版閱讀' : '開啟 GitHub issue 寬版閱讀';
  }

  function scan() {
    ensureWideToggle();
    applyWideMode(preferredWide);
    markWideTargets();
    document.querySelectorAll('textarea').forEach(textarea => {
      if (EDITOR_STATE.has(textarea)) return;
      if (!isGitHubMarkdownTextarea(textarea)) return;
      mountEditor(textarea);
    });
  }

  function isGitHubMarkdownTextarea(el) {
    if (!location.hostname.includes('github.com')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 240 || rect.height < 100) return false;
    if (el.disabled || el.readOnly) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const attrs = `${el.id} ${el.name} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`.toLowerCase();
    return /comment|issue|pull|discussion|markdown|body|description|readme/.test(attrs) || !!el.closest('.js-previewable-comment-form, .write-content, .comment-form-textarea');
  }

  function mountEditor(textarea) {
    const shell = textarea.closest('.write-content') || textarea.parentElement;
    if (!shell) return;

    const root = document.createElement('div');
    root.className = 'ghw-root';
    root.innerHTML = `
      <div class="ghw-toolbar" role="toolbar" aria-label="WYSIWYG toolbar">
        <div class="ghw-toolbar-group">
          <button type="button" class="ghw-btn" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" class="ghw-btn" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" class="ghw-btn" data-cmd="code" title="Inline code">&lt;/&gt;</button>
          <button type="button" class="ghw-btn" data-cmd="link" title="Link">🔗</button>
        </div>
        <div class="ghw-toolbar-group">
          <button type="button" class="ghw-btn" data-cmd="h2" title="Heading">H2</button>
          <button type="button" class="ghw-btn" data-cmd="ul" title="Bullet list">• List</button>
          <button type="button" class="ghw-btn" data-cmd="ol" title="Numbered list">1. List</button>
          <button type="button" class="ghw-btn" data-cmd="task" title="Task list">☑ Task</button>
          <button type="button" class="ghw-btn" data-cmd="blockquote" title="Quote">❝ Quote</button>
        </div>
        <div class="ghw-toolbar-group">
          <button type="button" class="ghw-btn" data-cmd="table" title="Insert table">Table</button>
          <button type="button" class="ghw-btn" data-cmd="codeblock" title="Code block">Code block</button>
          <button type="button" class="ghw-btn" data-cmd="hr" title="Divider">―</button>
        </div>
        <div class="ghw-toolbar-group ghw-table-tools" hidden>
          <button type="button" class="ghw-btn" data-cmd="add-row">+ Row</button>
          <button type="button" class="ghw-btn" data-cmd="add-col">+ Col</button>
          <button type="button" class="ghw-btn" data-cmd="del-row">− Row</button>
          <button type="button" class="ghw-btn" data-cmd="del-col">− Col</button>
        </div>
        <span class="ghw-status">保留 GitHub 原生 Write/Preview；WYSIWYG 只是一個額外模式</span>
      </div>
      <div class="ghw-editor" contenteditable="true" spellcheck="true"></div>
    `;
    shell.insertAdjacentElement('beforeend', root);

    const editor = root.querySelector('.ghw-editor');
    const state = {
      textarea,
      root,
      editor,
      syncing: false,
      mode: 'write',
      suppressNextTextareaSync: false,
      tableTools: root.querySelector('.ghw-table-tools')
    };
    EDITOR_STATE.set(textarea, state);

    const tabs = findTabs(shell);
    injectWysiwygTab(tabs, state);

    root.querySelector('.ghw-toolbar').addEventListener('click', e => onToolbarClick(e, state));
    editor.addEventListener('input', debounce(() => syncFromVisual(state), 120));
    editor.addEventListener('keydown', e => onEditorKeydown(e, state));
    editor.addEventListener('paste', e => onPaste(e, state));
    editor.addEventListener('click', () => updateTableToolsVisibility(state));
    editor.addEventListener('keyup', () => updateTableToolsVisibility(state));
    editor.addEventListener('change', e => onEditorChange(e, state));

    textarea.addEventListener('input', debounce(() => {
      if (state.syncing || state.mode !== 'write' || state.suppressNextTextareaSync) {
        state.suppressNextTextareaSync = false;
        return;
      }
      renderVisualFromMarkdown(state);
    }, 120));

    renderVisualFromMarkdown(state);
    applyMode(state, preferredMode);
  }

  function findTabs(shell) {
    const form = shell.closest('.js-previewable-comment-form, .previewable-comment-form') || document;
    return form.querySelector('[role="tablist"], .tabnav-tabs, .preview-tab, .js-write-tab')?.closest('[role="tablist"], .tabnav, .previewable-comment-form, .write-content, .comment-form-head') || form;
  }

  function injectWysiwygTab(container, state) {
    if (!container || container.querySelector('.ghw-tab')) return;
    const writeTab = container.querySelector('.js-write-tab, [data-tab-item="write-tab"], button[aria-controls*="write"], summary[aria-controls*="write"], .tabnav-tab');
    const previewTab = container.querySelector('.js-preview-tab, [data-tab-item="preview-tab"], button[aria-controls*="preview"], summary[aria-controls*="preview"]');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (writeTab?.className || 'tabnav-tab') + ' ghw-tab';
    btn.textContent = 'WYSIWYG';
    btn.title = '視覺編輯模式（不會取代 GitHub 原始 Markdown Write 模式）';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      applyMode(state, 'wysiwyg');
      preferredMode = 'wysiwyg';
      saveMode('wysiwyg');
    });

    const returnBtn = document.createElement('button');
    returnBtn.type = 'button';
    returnBtn.className = (writeTab?.className || 'tabnav-tab') + ' ghw-return-md-tab';
    returnBtn.textContent = 'Markdown 原始碼';
    returnBtn.title = '切回 GitHub 原始 Markdown 編輯器';
    returnBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      applyMode(state, 'write');
      preferredMode = 'write';
      saveMode('write');
    });

    if (previewTab && previewTab.parentElement) {
      previewTab.parentElement.insertBefore(btn, previewTab);
      if (btn.nextSibling) btn.parentElement.insertBefore(returnBtn, btn.nextSibling);
      else btn.parentElement.appendChild(returnBtn);
    } else {
      container.appendChild(btn);
      container.appendChild(returnBtn);
    }

    if (writeTab) {
      writeTab.addEventListener('click', () => {
        applyMode(state, 'write');
        preferredMode = 'write';
        saveMode('write');
      });
    }
    if (previewTab) {
      previewTab.addEventListener('click', () => {
        applyMode(state, 'write');
        preferredMode = 'write';
        saveMode('write');
      });
    }

    state.tab = btn;
    state.returnTab = returnBtn;
    state.writeTab = writeTab;
    state.previewTab = previewTab;
  }

  function applyMode(state, mode) {
    state.mode = mode;
    const active = mode === 'wysiwyg';
    state.root.classList.toggle('is-active', active);
    state.textarea.classList.toggle('ghw-hidden-source', active);
    state.root.setAttribute('aria-hidden', active ? 'false' : 'true');
    if (state.tab) {
      state.tab.classList.toggle('ghw-tab-active', active);
      state.tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (state.writeTab) {
      state.writeTab.classList.toggle('ghw-tab-active', !active);
      state.writeTab.setAttribute('aria-selected', active ? 'false' : 'true');
    }
    if (state.returnTab) {
      state.returnTab.classList.toggle('ghw-tab-active', !active);
      state.returnTab.setAttribute('aria-selected', active ? 'false' : 'true');
    }
    if (state.previewTab) state.previewTab.setAttribute('aria-selected', 'false');
    if (active) {
      renderVisualFromMarkdown(state);
      placeCaretAtEnd(state.editor);
      state.editor.focus();
    } else {
      state.textarea.focus();
    }
  }

  function onToolbarClick(e, state) {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    state.editor.focus();
    const cmd = btn.dataset.cmd;

    if (cmd === 'bold') document.execCommand('bold');
    else if (cmd === 'italic') document.execCommand('italic');
    else if (cmd === 'code') wrapSelectionWithInlineTag('code');
    else if (cmd === 'h2') formatBlock('h2');
    else if (cmd === 'ul') document.execCommand('insertUnorderedList');
    else if (cmd === 'ol') document.execCommand('insertOrderedList');
    else if (cmd === 'task') insertTaskList();
    else if (cmd === 'blockquote') formatBlock('blockquote');
    else if (cmd === 'link') {
      const url = prompt('Link URL');
      if (url) document.execCommand('createLink', false, url);
    } else if (cmd === 'table') insertTable();
    else if (cmd === 'codeblock') insertCodeBlock();
    else if (cmd === 'hr') insertNodeAtCursor(document.createElement('hr'));
    else if (cmd === 'add-row') tableAction(state, addRow);
    else if (cmd === 'add-col') tableAction(state, addCol);
    else if (cmd === 'del-row') tableAction(state, deleteRow);
    else if (cmd === 'del-col') tableAction(state, deleteCol);

    normalizeEditor(state.editor);
    syncFromVisual(state);
  }

  function onPaste(e, state) {
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain') || '';
    e.preventDefault();

    if (/\t/.test(text) && /\n/.test(text)) {
      insertTableFromTSV(text);
    } else if (html) {
      document.execCommand('insertText', false, stripHtmlToText(html));
    } else {
      document.execCommand('insertText', false, text);
    }

    normalizeEditor(state.editor);
    syncFromVisual(state);
  }

  function onEditorChange(e, state) {
    if (e.target.matches('.ghw-task-checkbox')) {
      syncFromVisual(state);
    }
  }

  function onEditorKeydown(e, state) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      document.execCommand('bold');
      syncFromVisual(state);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      document.execCommand('italic');
      syncFromVisual(state);
      return;
    }
    if (e.key === 'Tab') {
      const cell = getClosestTableCell();
      if (cell) {
        e.preventDefault();
        moveToNextCell(cell, e.shiftKey);
        return;
      }
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      syncFromVisual(state);
      return;
    }
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      applyMode(state, 'write');
      preferredMode = 'write';
      saveMode('write');
      return;
    }
    if (e.key === 'Enter') {
      const cell = getClosestTableCell();
      if (cell) {
        e.preventDefault();
        document.execCommand('insertLineBreak');
        syncFromVisual(state);
      }
    }
  }

  function wrapSelectionWithInlineTag(tag) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const wrapper = document.createElement(tag);
    wrapper.textContent = range.toString() || 'text';
    range.deleteContents();
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function formatBlock(tag) {
    try { document.execCommand('formatBlock', false, tag); }
    catch {
      const node = document.createElement(tag);
      node.textContent = window.getSelection()?.toString() || 'text';
      insertNodeAtCursor(node);
    }
  }

  function insertTaskList() {
    const ul = document.createElement('ul');
    ul.dataset.taskList = 'true';
    ul.className = 'ghw-task-list';
    const li = document.createElement('li');
    li.className = 'ghw-task-item';
    li.dataset.checked = 'false';
    li.innerHTML = `<label><input type="checkbox" class="ghw-task-checkbox"> <span>Task</span></label>`;
    ul.appendChild(li);
    insertNodeAtCursor(ul);
  }

  function insertTable() {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead><tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr></thead>
      <tbody>
        <tr><td></td><td></td><td></td></tr>
        <tr><td></td><td></td><td></td></tr>
      </tbody>
    `;
    insertNodeAtCursor(table);
    ensureEditableTableCells(table);
  }

  function insertTableFromTSV(text) {
    const rows = text.trim().split(/\r?\n/).map(line => line.split('\t'));
    if (!rows.length) return;
    const table = document.createElement('table');
    const [header, ...body] = rows;
    const width = Math.max(...rows.map(r => r.length));
    const norm = row => {
      const copy = [...row];
      while (copy.length < width) copy.push('');
      return copy;
    };
    table.innerHTML = `<thead><tr>${norm(header).map(v => `<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${norm(r).map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    insertNodeAtCursor(table);
    ensureEditableTableCells(table);
  }

  function insertCodeBlock() {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'code';
    pre.appendChild(code);
    insertNodeAtCursor(pre);
  }

  function insertNodeAtCursor(node) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function tableAction(state, fn) {
    const cell = getClosestTableCell();
    if (!cell) return;
    fn(cell.closest('table'), cell);
    ensureEditableTableCells(state.editor);
    updateTableToolsVisibility(state);
  }

  function addRow(table, cell) {
    const tr = cell.closest('tr');
    const row = document.createElement('tr');
    [...tr.children].forEach(() => {
      const td = document.createElement('td');
      td.innerHTML = '';
      row.appendChild(td);
    });
    tr.insertAdjacentElement('afterend', row);
  }

  function addCol(table, cell) {
    const cellIndex = [...cell.parentElement.children].indexOf(cell);
    table.querySelectorAll('tr').forEach(tr => {
      const newCell = document.createElement(tr.parentElement.tagName.toLowerCase() === 'thead' ? 'th' : 'td');
      newCell.innerHTML = '';
      const target = tr.children[cellIndex];
      if (target) target.insertAdjacentElement('afterend', newCell);
      else tr.appendChild(newCell);
    });
  }

  function deleteRow(table, cell) {
    const tbodyRows = table.querySelectorAll('tbody tr');
    const tr = cell.closest('tr');
    if (tr.parentElement.tagName.toLowerCase() === 'thead') return;
    if (tbodyRows.length <= 1) return;
    tr.remove();
  }

  function deleteCol(table, cell) {
    const index = [...cell.parentElement.children].indexOf(cell);
    const widths = table.querySelector('tr')?.children.length || 0;
    if (widths <= 2) return;
    table.querySelectorAll('tr').forEach(tr => tr.children[index]?.remove());
  }

  function moveToNextCell(cell, reverse = false) {
    const cells = [...cell.closest('table').querySelectorAll('th, td')];
    const index = cells.indexOf(cell);
    const next = cells[index + (reverse ? -1 : 1)] || cell;
    placeCaretAtStart(next);
  }

  function renderVisualFromMarkdown(state) {
    if (state.syncing) return;
    const markdown = state.textarea.value || '';
    state.editor.innerHTML = markdownToHtml(markdown);
    normalizeEditor(state.editor);
    ensureEditableTableCells(state.editor);
    updateTableToolsVisibility(state);
  }

  function ensureEditableTableCells(root) {
    root.querySelectorAll('th, td').forEach(cell => cell.setAttribute('contenteditable', 'true'));
    root.querySelectorAll('.ghw-task-item').forEach(li => {
      if (!li.querySelector('.ghw-task-checkbox')) {
        const checked = li.dataset.checked === 'true';
        const text = li.textContent.trim();
        li.innerHTML = `<label><input type="checkbox" class="ghw-task-checkbox" ${checked ? 'checked' : ''}> <span>${escapeHtml(text)}</span></label>`;
      }
    });
  }

  function normalizeEditor(root) {
    root.querySelectorAll('[style],[class]:not(.ghw-task-list):not(.ghw-task-item):not(.ghw-task-checkbox),[id]').forEach(el => {
      if (!el.classList.contains('ghw-task-list') && !el.classList.contains('ghw-task-item') && !el.classList.contains('ghw-task-checkbox')) {
        el.removeAttribute('class');
      }
      el.removeAttribute('style');
      el.removeAttribute('id');
    });
    root.querySelectorAll('div').forEach(div => {
      if (div.closest('li, blockquote, td, th, pre')) return;
      const p = document.createElement('p');
      p.innerHTML = div.innerHTML || '<br>';
      div.replaceWith(p);
    });
  }

  function syncFromVisual(state) {
    normalizeTaskLists(state.editor);
    normalizeEditor(state.editor);
    const markdown = htmlToMarkdown(state.editor);
    state.syncing = true;
    state.suppressNextTextareaSync = true;
    state.textarea.value = markdown;
    state.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    state.textarea.dispatchEvent(new Event('change', { bubbles: true }));
    state.syncing = false;
  }

  function normalizeTaskLists(root) {
    root.querySelectorAll('.ghw-task-item').forEach(li => {
      const checkbox = li.querySelector('.ghw-task-checkbox');
      const span = li.querySelector('span');
      li.dataset.checked = checkbox?.checked ? 'true' : 'false';
      if (span) {
        li.innerHTML = `<label><input type="checkbox" class="ghw-task-checkbox" ${checkbox?.checked ? 'checked' : ''}> <span>${escapeHtml(span.textContent || '')}</span></label>`;
      }
    });
  }

  function markdownToHtml(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line.trim())) {
        const lang = line.trim().slice(3).trim();
        const block = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          block.push(lines[i]);
          i++;
        }
        out.push(`<pre data-lang="${escapeHtml(lang)}"><code>${escapeHtml(block.join('\n'))}</code></pre>`);
        i++;
        continue;
      }
      if (looksLikeTable(lines, i)) {
        const { html, next } = parseTable(lines, i);
        out.push(html);
        i = next;
        continue;
      }
      if (/^\s*---+\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        out.push(`<h${level}>${inlineMarkdownToHtml(h[2])}</h${level}>`);
        i++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${quote.map(t => `<p>${inlineMarkdownToHtml(t)}</p>`).join('')}</blockquote>`);
        continue;
      }
      if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[i])) {
          const m = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
          items.push({ checked: /x/i.test(m[1]), text: m[2] });
          i++;
        }
        out.push(`<ul class="ghw-task-list" data-task-list="true">${items.map(item => `<li class="ghw-task-item" data-checked="${item.checked}"><label><input type="checkbox" class="ghw-task-checkbox" ${item.checked ? 'checked' : ''}> <span>${inlineMarkdownToHtml(item.text)}</span></label></li>`).join('')}</ul>`);
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        out.push(`<ul>${items.map(t => `<li>${inlineMarkdownToHtml(t)}</li>`).join('')}</ul>`);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        out.push(`<ol>${items.map(t => `<li>${inlineMarkdownToHtml(t)}</li>`).join('')}</ol>`);
        continue;
      }
      if (!line.trim()) {
        out.push('');
        i++;
        continue;
      }
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${inlineMarkdownToHtml(para.join('<br>'))}</p>`);
    }
    return out.join('\n');
  }

  function isBlockStart(lines, i) {
    const line = lines[i];
    return /^```/.test(line.trim()) || looksLikeTable(lines, i) || /^(#{1,6})\s+/.test(line) || /^>\s?/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || /^\s*---+\s*$/.test(line);
  }

  function looksLikeTable(lines, i) {
    return i + 1 < lines.length && lineLooksLikeRow(lines[i]) && lineLooksLikeDivider(lines[i + 1]);
  }

  function parseTable(lines, start) {
    const headers = splitTableRow(lines[start]);
    let i = start + 2;
    const rows = [];
    while (i < lines.length && lineLooksLikeRow(lines[i]) && !lineLooksLikeDivider(lines[i])) {
      rows.push(splitTableRow(lines[i]));
      i++;
    }
    const width = headers.length;
    const norm = row => {
      const x = [...row];
      while (x.length < width) x.push('');
      return x.slice(0, width);
    };
    const html = `<table><thead><tr>${norm(headers).map(v => `<th>${inlineMarkdownToHtml(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${norm(r).map(v => `<td>${inlineMarkdownToHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return { html, next: i };
  }

  function lineLooksLikeRow(line) {
    return line.includes('|') && splitTableRow(line).length >= 2;
  }

  function lineLooksLikeDivider(line) {
    const cells = splitTableRow(line);
    return cells.length >= 2 && cells.every(c => /^:?-{3,}:?$/.test(c.trim()));
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
  }

  function inlineMarkdownToHtml(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/&lt;br&gt;/g, '<br>');
    return s;
  }

  function htmlToMarkdown(root) {
    const parts = [];
    root.childNodes.forEach(node => {
      const md = nodeToMarkdown(node).trimEnd();
      if (md) parts.push(md);
    });
    return parts.join('\n\n').replace(/\n{3,}/g, '\n\n');
  }

  function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return cleanText(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    const tag = el.tagName.toLowerCase();

    if (tag === 'p') return inlineChildrenToMarkdown(el);
    if (/h[1-6]/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineChildrenToMarkdown(el)}`;
    if (tag === 'strong' || tag === 'b') return `**${inlineChildrenToMarkdown(el)}**`;
    if (tag === 'em' || tag === 'i') return `*${inlineChildrenToMarkdown(el)}*`;
    if (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${el.textContent || ''}\``;
    if (tag === 'a') return `[${inlineChildrenToMarkdown(el)}](${el.getAttribute('href') || ''})`;
    if (tag === 'blockquote') {
      return [...el.children].map(ch => nodeToMarkdown(ch, depth)).join('\n').split('\n').map(line => `> ${line}`).join('\n');
    }
    if (tag === 'ul' && el.dataset.taskList === 'true') {
      return [...el.children].map(li => {
        const checked = li.querySelector('.ghw-task-checkbox')?.checked ? 'x' : ' ';
        const text = cleanText(li.querySelector('span')?.textContent || li.textContent || '');
        return `${'  '.repeat(depth)}- [${checked}] ${text}`;
      }).join('\n');
    }
    if (tag === 'ul') return [...el.children].map(li => `${'  '.repeat(depth)}- ${inlineChildrenToMarkdown(li)}`).join('\n');
    if (tag === 'ol') return [...el.children].map((li, i) => `${'  '.repeat(depth)}${i + 1}. ${inlineChildrenToMarkdown(li)}`).join('\n');
    if (tag === 'pre') {
      const lang = el.getAttribute('data-lang') || '';
      const code = el.textContent?.replace(/\n$/, '') || '';
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    if (tag === 'hr') return '---';
    if (tag === 'table') return tableToMarkdown(el);
    if (tag === 'br') return '  \n';
    if (tag === 'li') return inlineChildrenToMarkdown(el);
    if (tag === 'div') return [...el.childNodes].map(ch => nodeToMarkdown(ch, depth)).join('\n');
    return inlineChildrenToMarkdown(el);
  }

  function inlineChildrenToMarkdown(el) {
    return [...el.childNodes].map(ch => {
      if (ch.nodeType === Node.TEXT_NODE) return cleanText(ch.textContent || '');
      return nodeToMarkdown(ch);
    }).join('').replace(/\u00a0/g, ' ').trim();
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(cell => inlineChildrenToMarkdown(cell).replace(/\|/g, '\\|')));
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    const normalized = rows.map(r => {
      const x = [...r];
      while (x.length < width) x.push('');
      return x;
    });
    const widths = Array.from({ length: width }, (_, i) => Math.max(3, ...normalized.map(r => visualLength(r[i] || ''))));
    const header = formatTableRow(normalized[0], widths);
    const divider = `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`;
    const body = normalized.slice(1).map(r => formatTableRow(r, widths));
    return [header, divider, ...body].join('\n');
  }

  function formatTableRow(cells, widths) {
    return `| ${cells.map((c, i) => padVisual(c || '', widths[i])).join(' | ')} |`;
  }

  function visualLength(value) {
    return [...String(value)].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
  }

  function padVisual(value, width) {
    return String(value) + ' '.repeat(Math.max(0, width - visualLength(value)));
  }

  function cleanText(s) {
    return s.replace(/ /g, ' ').replace(/\s+/g, ' ');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripHtmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  function getClosestTableCell() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    const element = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
    return element?.closest?.('th, td') || null;
  }

  function updateTableToolsVisibility(state) {
    state.tableTools.hidden = !getClosestTableCell();
  }

  function placeCaretAtStart(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.focus();
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
})();

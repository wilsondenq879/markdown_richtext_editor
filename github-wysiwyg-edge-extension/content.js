(() => {
  'use strict';

  const EXT_NS = 'ghx';
  const EXT_VERSION = chrome?.runtime?.getManifest?.().version || 'dev';
  const STORAGE_KEYS = {
    wideMode: 'ghxWideMode'
  };

  const editorInstances = new WeakMap();
  const enhancedTextareas = new Set();

  let wideToggleEl = null;
  let currentWideMode = true;
  let scanScheduled = false;

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanEditors(document);
      scanMarkdownCodeMirrorEditors(document);
      refreshEnhancedEditors();
      ensureWideToggle();
    });
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isMarkdownFileEditPage() {
    const path = window.location.pathname.toLowerCase();
    if (/\/(edit|new)\/.+\.(md|markdown|mdx|mkdn|mdown)$/i.test(path)) return true;
    const fileNameInput = document.querySelector('input[name="filename"], input[id*="filename"]');
    if (fileNameInput && /\.(md|markdown|mdx|mkdn|mdown)$/i.test(fileNameInput.value || '')) return true;
    return false;
  }

  function isCandidateTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    if (textarea.disabled || textarea.readOnly) return false;
    if (!textarea.isConnected) return false;
    if (textarea.dataset.ghxEnhanced === '1') return false;
    if (textarea.closest(`.${EXT_NS}-editor-shell`)) return false;

    if (isMarkdownFileEditPage() && hasVisibleMarkdownCodeMirror(textarea)) return false;

    const markdownSurface = resolveMarkdownSurface(textarea);
    if (!isVisible(textarea) && !markdownSurface) return false;

    const meta = [
      textarea.name,
      textarea.id,
      textarea.className,
      textarea.getAttribute('aria-label'),
      textarea.getAttribute('data-testid'),
      textarea.getAttribute('placeholder')
    ].join(' ').toLowerCase();

    const ancestorMatch = textarea.closest([
      '[data-previewable-comment-form]',
      '.js-previewable-comment-form',
      '.previewable-comment-form',
      '.timeline-comment-wrapper',
      '.js-comment-field-container',
      '.js-comment-body',
      '.discussion-timeline',
      '.repository-content',
      '.write-content',
      '[role="dialog"]',
      '[data-testid*="issue"]',
      '[data-testid*="comment"]',
      'aside',
      'form'
    ].join(','));

    if (markdownSurface) return true;
    if (/(comment|markdown|body|issue|description|details|write|reply)/.test(meta)) return true;
    if (ancestorMatch && textarea.rows >= 4) return true;
    return false;
  }

  function resolveMarkdownSurface(textarea) {
    if (!isMarkdownFileEditPage()) return null;
    const meta = [
      textarea.name,
      textarea.id,
      textarea.className,
      textarea.getAttribute('aria-label'),
      textarea.getAttribute('data-testid')
    ].join(' ').toLowerCase();
    const isMarkdownSource = /(value|blob|code|editor|content|markdown)/.test(meta);

    const cmEditor = findMarkdownFileCodeMirror(textarea);
    if (cmEditor && isMarkdownSource) {
      return {
        type: 'codemirror',
        element: cmEditor,
        inputTarget: cmEditor.querySelector('.cm-content') || cmEditor,
        view: findCodeMirrorView(cmEditor)
      };
    }

    if (!cmEditor && isVisible(textarea) && isMarkdownSource) {
      return {
        type: 'textarea',
        element: textarea,
        inputTarget: textarea,
        view: null
      };
    }

    return null;
  }

  function findMarkdownFileCodeMirror(textarea) {
    const containers = [
      textarea.closest('form'),
      textarea.closest('.js-blob-form'),
      textarea.closest('[data-testid="commit-form"]'),
      document
    ].filter(Boolean);

    for (const container of containers) {
      const editors = Array.from(container.querySelectorAll('.cm-editor')).filter(isVisible);
      if (editors.length === 1) return editors[0];
      if (editors.length > 1) {
        const preferred = editors.find((editor) => editor.querySelector('.cm-content'));
        if (preferred) return preferred;
      }
    }

    return null;
  }

  function hasVisibleMarkdownCodeMirror(textarea) {
    return Boolean(findMarkdownFileCodeMirror(textarea));
  }

  function findCodeMirrorView(element) {
    const candidates = [
      element,
      element?.querySelector('.cm-content'),
      element?.querySelector('.cm-scroller')
    ].filter(Boolean);

    for (const candidate of candidates) {
      let current = candidate;
      while (current) {
        const cmView = current.cmView;
        const directView = cmView?.view;
        if (directView?.dispatch && directView?.state?.doc) return directView;
        const rootView = cmView?.rootView?.view;
        if (rootView?.dispatch && rootView?.state?.doc) return rootView;
        const editorView = current.editorView;
        if (editorView?.dispatch && editorView?.state?.doc) return editorView;
        const direct = current.view;
        if (direct?.dispatch && direct?.state?.doc) return direct;
        if (current.CodeMirror?.dispatch && current.CodeMirror?.state?.doc) return current.CodeMirror;
        current = current.parentNode;
      }
    }

    return null;
  }

  function scanEditors(root = document) {
    if (isMarkdownFileEditPage()) return;
    const textareas = root.querySelectorAll('textarea');
    textareas.forEach((textarea) => {
      if (isCandidateTextarea(textarea)) {
        enhanceTextarea(textarea);
      }
    });
  }

  function scanMarkdownCodeMirrorEditors(root = document) {
    if (!isMarkdownFileEditPage()) return;

    root.querySelectorAll('.cm-editor').forEach((editor) => {
      if (!isVisible(editor)) return;
      if (editor.closest(`.${EXT_NS}-editor-shell`)) return;
      if (editorInstances.has(editor)) return;
      if (!isLikelyMarkdownFileEditor(editor)) return;

      const markdownSurface = {
        type: 'codemirror',
        element: editor,
        inputTarget: editor.querySelector('.cm-content') || editor,
        view: findCodeMirrorView(editor)
      };

      const textarea = findTextareaForMarkdownSurface(editor) || document.createElement('textarea');
      enhanceTextarea(textarea, markdownSurface);
    });
  }

  function isLikelyMarkdownFileEditor(editor) {
    if (!editor.querySelector('.cm-content')) return false;

    const contextText = [
      editor.className,
      editor.getAttribute('aria-label'),
      editor.closest('form')?.className,
      editor.closest('form')?.getAttribute('aria-label'),
      document.querySelector('input[name="filename"], input[id*="filename"]')?.value
    ].filter(Boolean).join(' ').toLowerCase();

    if (/commit|description|title/.test(contextText) && !/\.md|\.markdown|\.mdx|markdown/.test(contextText)) {
      return false;
    }

    return true;
  }

  function findTextareaForMarkdownSurface(editor) {
    const containers = [editor.closest('form'), editor.closest('.js-blob-form'), document].filter(Boolean);
    for (const container of containers) {
      const match = Array.from(container.querySelectorAll('textarea')).find((candidate) => {
        const meta = [
          candidate.name,
          candidate.id,
          candidate.className,
          candidate.getAttribute('aria-label'),
          candidate.getAttribute('data-testid')
        ].join(' ').toLowerCase();
        return /(value|blob|code|editor|content|markdown)/.test(meta);
      });
      if (match) return match;
    }
    return null;
  }

  function refreshEnhancedEditors() {
    Array.from(enhancedTextareas).forEach((sourceKey) => {
      const instance = editorInstances.get(sourceKey);
      if (!sourceKey?.isConnected || !instance?.shell?.isConnected || !instance?.markdownSurface?.element?.isConnected) {
        enhancedTextareas.delete(sourceKey);
        editorInstances.delete(sourceKey);
        return;
      }
      if (instance.mode === 'wysiwyg' && !instance.editor.matches(':focus') && instance.lastKnownMarkdown !== getMarkdownValue(instance)) {
        syncEditorFromTextarea(instance);
      }
      updateShellWidth(instance);
    });
  }

  function updateShellWidth(instance) {
    if (!instance || !instance.textarea || !instance.shell) return;
    instance.shell.style.width = '100%';
  }

  function enhanceTextarea(textarea, providedMarkdownSurface = null) {
    const markdownSurface = providedMarkdownSurface || resolveMarkdownSurface(textarea) || {
      type: 'textarea',
      element: textarea,
      inputTarget: textarea,
      view: null
    };
    const sourceKey = markdownSurface.element || textarea;
    if (editorInstances.has(sourceKey)) return;

    const shell = document.createElement('div');
    shell.className = `${EXT_NS}-editor-shell`;

    const toolbar = document.createElement('div');
    toolbar.className = `${EXT_NS}-toolbar`;

    const modes = document.createElement('div');
    modes.className = `${EXT_NS}-mode-group`;

    const mdButton = createButton('Markdown', '切回原生 Markdown 編輯模式');
    const wysButton = createButton('WYSIWYG', '切換到所見即所得編輯模式');
    mdButton.classList.add('is-active');
    modes.append(mdButton, wysButton);

    const tools = document.createElement('div');
    tools.className = `${EXT_NS}-tool-group`;

    const toolDefs = [
      { key: 'bold', label: 'B', title: '粗體' },
      { key: 'italic', label: 'I', title: '斜體' },
      { key: 'strike', label: 'S', title: '刪除線' },
      { key: 'code', label: '</>', title: '行內程式碼' },
      { key: 'codeblock', label: '{ }', title: '程式碼區塊' },
      { key: 'link', label: '🔗', title: '連結' },
      { key: 'ul', label: '•', title: '無序清單' },
      { key: 'ol', label: '1.', title: '有序清單' },
      { key: 'task', label: '☑', title: 'Task List' },
      { key: 'table', label: '▦', title: '表格' },
      { key: 'addCol', label: '+C', title: '新增欄' },
      { key: 'removeCol', label: '-C', title: '刪除欄' },
      { key: 'addRow', label: '+R', title: '新增列' },
      { key: 'removeRow', label: '-R', title: '刪除列' },
      { key: 'quote', label: '❝', title: '引用' },
      { key: 'h1', label: 'H1', title: '標題 1' },
      { key: 'h2', label: 'H2', title: '標題 2' },
      { key: 'h3', label: 'H3', title: '標題 3' },
      { key: 'hr', label: '—', title: '分隔線' }
    ];

    const toolButtons = {};
    toolDefs.forEach((def) => {
      const btn = createButton(def.label, def.title);
      btn.dataset.action = def.key;
      btn.classList.add(`${EXT_NS}-tool-btn`);
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const instance = editorInstances.get(sourceKey);
        if (!instance) return;
        const wysiwygOnlyActions = new Set(['addCol', 'removeCol', 'addRow', 'removeRow']);
        if (instance.mode === 'wysiwyg') {
          applyRichCommand(instance, def.key);
        } else if (wysiwygOnlyActions.has(def.key)) {
          setMode(instance, 'wysiwyg');
          applyRichCommand(instance, def.key);
        } else if (instance.markdownSurface.type !== 'textarea') {
          setMode(instance, 'wysiwyg');
          applyRichCommand(instance, def.key);
        } else {
          applyMarkdownCommand(instance, def.key);
        }
      });
      toolButtons[def.key] = btn;
      tools.appendChild(btn);
    });

    const hint = document.createElement('div');
    hint.className = `${EXT_NS}-hint`;
    hint.textContent = '動態載入的 GitHub 編輯器也會自動插入這組切換工具。';

    toolbar.append(modes, tools, hint);

    const editor = document.createElement('div');
    editor.className = `${EXT_NS}-wysiwyg`;
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('data-placeholder', '開始以 WYSIWYG 方式編輯…');
    editor.style.display = 'none';

    const parent = markdownSurface.element.parentNode;
    if (!parent) return;
    parent.insertBefore(shell, markdownSurface.element);
    shell.append(toolbar, markdownSurface.element, editor);

    if (markdownSurface.type === 'textarea') {
      textarea.classList.add(`${EXT_NS}-textarea`);
    } else {
      shell.classList.add(`${EXT_NS}-external-markdown-surface`);
      markdownSurface.element.classList.add(`${EXT_NS}-markdown-surface`);
    }
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.dataset.ghxEnhanced = '1';
    }

    const instance = {
      sourceKey,
      textarea,
      markdownSurface,
      markdownSurfaceDisplay: markdownSurface.element.style.display,
      shell,
      toolbar,
      editor,
      mdButton,
      wysButton,
      toolButtons,
      mode: 'markdown',
      syncing: false,
      lastKnownMarkdown: getMarkdownValue({ textarea, markdownSurface }) || ''
    };

    const handleMarkdownSurfaceInput = () => {
      if (instance.syncing) return;
      instance.lastKnownMarkdown = getMarkdownValue(instance);
      if (instance.mode === 'wysiwyg' && document.activeElement !== instance.editor) {
        syncEditorFromTextarea(instance);
      }
    };

    mdButton.addEventListener('click', (event) => {
      event.preventDefault();
      setMode(instance, 'markdown');
    });

    wysButton.addEventListener('click', (event) => {
      event.preventDefault();
      setMode(instance, 'wysiwyg');
    });

    if (textarea instanceof HTMLTextAreaElement) {
      textarea.addEventListener('input', handleMarkdownSurfaceInput);
      textarea.addEventListener('change', handleMarkdownSurfaceInput);
    }
    if (markdownSurface.inputTarget !== textarea) {
      markdownSurface.inputTarget.addEventListener('input', handleMarkdownSurfaceInput);
      markdownSurface.inputTarget.addEventListener('keyup', handleMarkdownSurfaceInput);
      markdownSurface.inputTarget.addEventListener('change', handleMarkdownSurfaceInput);
      markdownSurface.inputTarget.addEventListener('blur', handleMarkdownSurfaceInput);
    }

    editor.addEventListener('input', () => syncTextareaFromEditor(instance));
    editor.addEventListener('blur', () => syncTextareaFromEditor(instance, true));
    editor.addEventListener('keydown', (event) => handleEditorKeydown(event, instance));
    editor.addEventListener('paste', (event) => handleEditorPaste(event, instance));
    editor.addEventListener('click', (event) => handleEditorClick(event, instance));
    editor.addEventListener('change', (event) => handleEditorChange(event, instance));

    editorInstances.set(sourceKey, instance);
    enhancedTextareas.add(sourceKey);
    updateShellWidth(instance);
  }

  function createButton(label, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${EXT_NS}-btn`;
    btn.textContent = label;
    btn.title = title;
    return btn;
  }

  function setMode(instance, mode) {
    if (!instance || instance.mode === mode) return;

    if (mode === 'wysiwyg') {
      syncEditorFromTextarea(instance);
      setMarkdownSurfaceVisibility(instance, false);
      instance.editor.style.display = 'block';
      instance.wysButton.classList.add('is-active');
      instance.mdButton.classList.remove('is-active');
      instance.mode = 'wysiwyg';
      instance.shell.classList.add('is-wysiwyg');
      instance.editor.focus();
      placeCaretAtEnd(instance.editor);
    } else {
      syncTextareaFromEditor(instance, true);
      setMarkdownSurfaceVisibility(instance, true);
      instance.editor.style.display = 'none';
      instance.mdButton.classList.add('is-active');
      instance.wysButton.classList.remove('is-active');
      instance.mode = 'markdown';
      instance.shell.classList.remove('is-wysiwyg');
      focusMarkdownSurface(instance);
    }
  }

  function setMarkdownSurfaceVisibility(instance, visible) {
    if (!instance?.markdownSurface?.element) return;
    instance.markdownSurface.element.style.display = visible ? instance.markdownSurfaceDisplay : 'none';
  }

  function focusMarkdownSurface(instance) {
    const target = instance?.markdownSurface?.inputTarget || instance?.textarea;
    target?.focus?.();
  }

  function handleEditorKeydown(event, instance) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      applyRichCommand(instance, 'bold');
    } else if (key === 'i') {
      event.preventDefault();
      applyRichCommand(instance, 'italic');
    } else if (key === 'k') {
      event.preventDefault();
      applyRichCommand(instance, 'link');
    }
  }

  function handleEditorPaste(event, instance) {
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');
    if (html) {
      insertHtmlAtCursor(sanitizeHtml(html));
    } else if (text) {
      insertHtmlAtCursor(escapeHtml(text).replace(/\n/g, '<br>'));
    }
    syncTextareaFromEditor(instance);
  }

  function handleEditorClick(event, instance) {
    const checkbox = event.target.closest(`.${EXT_NS}-task-checkbox`);
    if (!checkbox) return;
    event.stopPropagation();
  }

  function handleEditorChange(event, instance) {
    const checkbox = event.target.closest(`.${EXT_NS}-task-checkbox`);
    if (!checkbox) return;
    const listItem = checkbox.closest('li');
    if (listItem) {
      listItem.dataset.task = checkbox.checked ? 'done' : 'todo';
    }
    syncTextareaFromEditor(instance, true);
  }

  function syncEditorFromTextarea(instance) {
    const markdown = getMarkdownValue(instance);
    instance.editor.innerHTML = sanitizeHtml(markdownToHtml(markdown));
    decorateTaskLists(instance.editor);
    instance.lastKnownMarkdown = markdown;
    ensureEditorPlaceholder(instance.editor);
  }

  function syncTextareaFromEditor(instance, fireChange = false) {
    if (!instance || instance.syncing) return;
    instance.syncing = true;
    try {
      ensureEditorPlaceholder(instance.editor);
      const markdown = htmlToMarkdown(instance.editor.innerHTML);
      if (getMarkdownValue(instance) !== markdown) {
        setMarkdownValue(instance, markdown, fireChange);
        instance.lastKnownMarkdown = markdown;
      }
    } finally {
      instance.syncing = false;
    }
  }

  function getMarkdownValue(instance) {
    const view = instance?.markdownSurface?.view;
    if (view?.state?.doc) {
      return view.state.doc.toString();
    }
    if (instance?.markdownSurface?.type === 'codemirror') {
      const fallback = getCodeMirrorDomText(instance.markdownSurface.element);
      if (fallback) return fallback;
    }
    return instance?.textarea?.value || '';
  }

  function getCodeMirrorDomText(editorEl) {
    if (!editorEl) return '';
    const lines = Array.from(editorEl.querySelectorAll('.cm-line'));
    if (!lines.length) return '';
    return lines
      .map((line) => (line.textContent || '').replace(/\u00a0/g, ' '))
      .join('\n');
  }

  function setMarkdownValue(instance, markdown, fireChange = false) {
    const view = instance?.markdownSurface?.view;
    const currentValue = getMarkdownValue(instance);
    if (currentValue === markdown) return;

    if (view?.dispatch && view?.state?.doc) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: markdown
        }
      });
    }

    if (instance?.textarea && instance.textarea.value !== markdown) {
      instance.textarea.value = markdown;
    }

    if (instance?.textarea) {
      dispatchTextInputEvents(instance.textarea, fireChange);
    }
  }

  function dispatchTextInputEvents(textarea, fireChange = false) {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (fireChange) {
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function ensureEditorPlaceholder(editor) {
    const text = editor.textContent.replace(/\u00a0/g, ' ').trim();
    editor.classList.toggle('is-empty', !text && !editor.querySelector('img, hr, pre, code, ul, ol, blockquote, h1, h2, h3, h4, h5, h6'));
  }

  function applyRichCommand(instance, action) {
    instance.editor.focus();
    switch (action) {
      case 'bold':
        document.execCommand('bold');
        break;
      case 'italic':
        document.execCommand('italic');
        break;
      case 'strike':
        document.execCommand('strikeThrough');
        break;
      case 'ul':
        document.execCommand('insertUnorderedList');
        break;
      case 'ol':
        document.execCommand('insertOrderedList');
        break;
      case 'task':
        insertTaskList(instance.editor);
        break;
      case 'table':
        insertTable(instance.editor);
        break;
      case 'addCol':
        addTableColumn(instance.editor);
        break;
      case 'removeCol':
        removeTableColumn(instance.editor);
        break;
      case 'addRow':
        addTableRow(instance.editor);
        break;
      case 'removeRow':
        removeTableRow(instance.editor);
        break;
      case 'quote':
        document.execCommand('formatBlock', false, 'blockquote');
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        document.execCommand('formatBlock', false, action.toUpperCase());
        break;
      case 'hr':
        insertHtmlAtCursor('<hr>');
        break;
      case 'code':
        wrapSelectionWithHtml('code');
        break;
      case 'codeblock':
        insertCodeBlock();
        break;
      case 'link': {
        const url = window.prompt('請輸入連結 URL', 'https://');
        if (url) {
          document.execCommand('createLink', false, url);
        }
        break;
      }
      default:
        break;
    }
    decorateTaskLists(instance.editor);
    syncTextareaFromEditor(instance);
  }

  function wrapSelectionWithHtml(tagName) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!range || range.collapsed) {
      insertHtmlAtCursor(`<${tagName}>文字</${tagName}>`);
      return;
    }
    const selected = range.extractContents();
    const wrapper = document.createElement(tagName);
    wrapper.appendChild(selected);
    range.insertNode(wrapper);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    selection.addRange(newRange);
  }

  function insertCodeBlock() {
    const selection = window.getSelection();
    const text = selection && selection.rangeCount > 0 ? selection.toString() : '';
    const safeText = escapeHtml(text || 'code');
    insertHtmlAtCursor(`<pre><code>${safeText}</code></pre>`);
  }

  function insertTaskList(editor) {
    const selection = window.getSelection();
    const selectedText = selection && selection.rangeCount > 0 ? selection.toString() : '';
    const items = selectedText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const html = `<ul>${(items.length ? items : ['待辦事項']).map((item) => `<li data-task="todo">${escapeHtml(item)}</li>`).join('')}</ul>`;
    insertHtmlAtCursor(html);
    decorateTaskLists(editor);
  }

  function insertTable(editor) {
    const html = [
      '<table>',
      '<thead><tr><th>欄位 1</th><th>欄位 2</th></tr></thead>',
      '<tbody><tr><td>內容 1</td><td>內容 2</td></tr></tbody>',
      '</table>',
      '<p></p>'
    ].join('');
    insertHtmlAtCursor(html);
    decorateTaskLists(editor);
  }

  function getActiveTableCell(editor) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    let node = selection.anchorNode;
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!(node instanceof Element)) return null;
    const cell = node.closest('td, th');
    if (!cell || !editor.contains(cell)) return null;
    return cell;
  }

  function addTableColumn(editor) {
    const cell = getActiveTableCell(editor);
    const table = cell?.closest('table');
    if (!cell || !table) return;
    const colIndex = cell.cellIndex;

    Array.from(table.rows).forEach((row) => {
      const insertBefore = row.children[colIndex + 1] || null;
      const tagName = row.parentElement?.tagName.toLowerCase() === 'thead' ? 'th' : 'td';
      const newCell = document.createElement(tagName);
      newCell.textContent = tagName === 'th' ? `欄位 ${colIndex + 2}` : '內容';
      row.insertBefore(newCell, insertBefore);
    });
  }

  function removeTableColumn(editor) {
    const cell = getActiveTableCell(editor);
    const table = cell?.closest('table');
    if (!cell || !table) return;
    const colIndex = cell.cellIndex;
    const firstRow = table.rows[0];
    if (!firstRow || firstRow.children.length <= 1) return;

    Array.from(table.rows).forEach((row) => {
      if (row.children[colIndex]) {
        row.removeChild(row.children[colIndex]);
      }
    });
  }

  function addTableRow(editor) {
    const cell = getActiveTableCell(editor);
    const table = cell?.closest('table');
    const row = cell?.parentElement;
    if (!cell || !table || !row) return;

    const sectionTag = row.parentElement?.tagName.toLowerCase();
    const targetSection = sectionTag === 'thead'
      ? (table.tBodies[0] || table.appendChild(document.createElement('tbody')))
      : row.parentElement;

    const colCount = row.children.length || table.rows[0]?.children.length || 2;
    const newRow = document.createElement('tr');
    for (let i = 0; i < colCount; i += 1) {
      const td = document.createElement('td');
      td.textContent = '內容';
      newRow.appendChild(td);
    }

    if (sectionTag === 'thead') {
      targetSection.insertBefore(newRow, targetSection.firstChild || null);
      return;
    }

    const nextRow = row.nextSibling;
    targetSection.insertBefore(newRow, nextRow || null);
  }

  function removeTableRow(editor) {
    const cell = getActiveTableCell(editor);
    const table = cell?.closest('table');
    const row = cell?.parentElement;
    if (!cell || !table || !row) return;

    const sectionTag = row.parentElement?.tagName.toLowerCase();
    if (sectionTag === 'thead') return;
    if (row.parentElement.children.length <= 1) return;
    row.parentElement.removeChild(row);
  }

  function insertHtmlAtCursor(html) {
    document.execCommand('insertHTML', false, html);
  }

  function applyMarkdownCommand(instance, action) {
    const textarea = instance.textarea;
    textarea.focus();

    switch (action) {
      case 'bold':
        wrapTextareaSelection(textarea, '**', '**');
        break;
      case 'italic':
        wrapTextareaSelection(textarea, '*', '*');
        break;
      case 'strike':
        wrapTextareaSelection(textarea, '~~', '~~');
        break;
      case 'code':
        wrapTextareaSelection(textarea, '`', '`');
        break;
      case 'codeblock':
        wrapTextareaSelection(textarea, '\n```\n', '\n```\n');
        break;
      case 'link': {
        const selection = getTextareaSelection(textarea) || '連結文字';
        const url = window.prompt('請輸入連結 URL', 'https://');
        if (url) {
          replaceTextareaSelection(textarea, `[${selection}](${url})`);
        }
        break;
      }
      case 'ul':
        prefixSelectedLines(textarea, '- ');
        break;
      case 'ol':
        numberSelectedLines(textarea);
        break;
      case 'task':
        prefixSelectedLines(textarea, '- [ ] ');
        break;
      case 'table':
        insertMarkdownTable(textarea);
        break;
      case 'quote':
        prefixSelectedLines(textarea, '> ');
        break;
      case 'h1':
        prefixHeading(textarea, '# ');
        break;
      case 'h2':
        prefixHeading(textarea, '## ');
        break;
      case 'h3':
        prefixHeading(textarea, '### ');
        break;
      case 'hr':
        replaceTextareaSelection(textarea, '\n---\n');
        break;
      default:
        break;
    }

    instance.lastKnownMarkdown = textarea.value;
    dispatchTextInputEvents(textarea, true);
  }

  function getTextareaSelection(textarea) {
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  }

  function replaceTextareaSelection(textarea, replacement) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.slice(0, start) + replacement + value.slice(end);
    const caret = start + replacement.length;
    textarea.setSelectionRange(caret, caret);
  }

  function wrapTextareaSelection(textarea, prefix, suffix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || '文字';
    const replacement = `${prefix}${selected}${suffix}`;
    textarea.value = textarea.value.slice(0, start) + replacement + textarea.value.slice(end);
    const selStart = start + prefix.length;
    const selEnd = selStart + selected.length;
    textarea.setSelectionRange(selStart, selEnd);
  }

  function prefixSelectedLines(textarea, prefix) {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const replaced = block
      .split('\n')
      .map((line) => (line.trim() ? `${prefix}${line}` : line))
      .join('\n');

    textarea.value = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    textarea.setSelectionRange(lineStart, lineStart + replaced.length);
  }

  function numberSelectedLines(textarea) {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    let count = 1;
    const replaced = block
      .split('\n')
      .map((line) => {
        if (!line.trim()) return line;
        const result = `${count}. ${line}`;
        count += 1;
        return result;
      })
      .join('\n');

    textarea.value = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    textarea.setSelectionRange(lineStart, lineStart + replaced.length);
  }

  function prefixHeading(textarea, prefix) {
    const selection = getTextareaSelection(textarea);
    if (!selection.includes('\n')) {
      const selected = selection || '標題';
      replaceTextareaSelection(textarea, `${prefix}${selected}`);
      return;
    }
    prefixSelectedLines(textarea, prefix);
  }

  function insertMarkdownTable(textarea) {
    const template = [
      '| 欄位 1 | 欄位 2 |',
      '| --- | --- |',
      '| 內容 1 | 內容 2 |'
    ].join('\n');
    const selected = getTextareaSelection(textarea);
    if (selected && selected.trim()) {
      replaceTextareaSelection(textarea, `${selected}\n\n${template}`);
      return;
    }
    replaceTextareaSelection(textarea, template);
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    let html = '';

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i += 1;
        continue;
      }

      const fenceMatch = line.match(/^```([^`]*)$/);
      if (fenceMatch) {
        const lang = (fenceMatch[1] || '').trim();
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length && /^```/.test(lines[i])) i += 1;
        const code = escapeHtml(codeLines.join('\n'));
        html += `<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${code}</code></pre>`;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        html += '<hr>';
        i += 1;
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        html += `<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`;
        i += 1;
        continue;
      }

      if (isTableStart(lines, i)) {
        const { html: tableHtml, nextIndex } = parseTable(lines, i);
        html += tableHtml;
        i = nextIndex;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        const inner = markdownToHtml(quoteLines.join('\n')) || '<p></p>';
        html += `<blockquote>${inner}</blockquote>`;
        continue;
      }

      if (/^(?:[-*+]\s+|\d+\.\s+)/.test(line)) {
        const { html: listHtml, nextIndex } = parseList(lines, i);
        html += listHtml;
        i = nextIndex;
        continue;
      }

      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !startsSpecialBlock(lines, i)) {
        paragraph.push(lines[i]);
        i += 1;
      }
      html += `<p>${paragraph.map((segment) => parseInlineMarkdown(segment)).join('<br>')}</p>`;
    }

    return html;
  }

  function startsSpecialBlock(lines, index) {
    const line = lines[index] || '';
    return Boolean(
      /^```/.test(line) ||
      /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim()) ||
      /^(#{1,6})\s+/.test(line) ||
      /^>\s?/.test(line) ||
      /^(?:[-*+]\s+|\d+\.\s+)/.test(line) ||
      isTableStart(lines, index)
    );
  }

  function parseList(lines, startIndex) {
    const first = lines[startIndex];
    const ordered = /^\d+\.\s+/.test(first);
    const tag = ordered ? 'ol' : 'ul';
    let html = `<${tag}>`;
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      const listRegex = ordered ? /^(\d+)\.\s+(.*)$/ : /^[-*+]\s+(.*)$/;
      const match = line.match(listRegex);
      if (!match) break;
      const content = ordered ? match[2] : match[1];
      const taskMatch = content.match(/^\[( |x|X)\]\s+(.*)$/);
      if (taskMatch) {
        const checked = /x/i.test(taskMatch[1]);
        html += `<li data-task="${checked ? 'done' : 'todo'}">${parseInlineMarkdown(taskMatch[2])}</li>`;
      } else {
        html += `<li>${parseInlineMarkdown(content)}</li>`;
      }
      i += 1;
    }

    html += `</${tag}>`;
    return { html, nextIndex: i };
  }

  function isTableStart(lines, index) {
    const current = lines[index] || '';
    const next = lines[index + 1] || '';
    return /\|/.test(current) && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(next);
  }

  function parseTable(lines, startIndex) {
    const headerCells = splitTableRow(lines[startIndex]);
    let i = startIndex + 2;
    const rows = [];
    while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }

    let html = '<table><thead><tr>';
    headerCells.forEach((cell) => {
      html += `<th>${parseInlineMarkdown(cell)}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr>';
      row.forEach((cell) => {
        html += `<td>${parseInlineMarkdown(cell)}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';

    return { html, nextIndex: i };
  }

  function splitTableRow(row) {
    return row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function parseInlineMarkdown(text) {
    let safe = escapeHtml(text);

    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const cleanSrc = safeUrl(src);
      return cleanSrc ? `<img src="${cleanSrc}" alt="${escapeHtml(alt)}">` : escapeHtml(_);
    });

    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const cleanHref = safeUrl(href);
      return cleanHref ? `<a href="${cleanHref}" target="_blank" rel="noopener noreferrer">${label}</a>` : `[${label}](${href})`;
    });

    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    safe = safe.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    safe = safe.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    safe = safe.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return safe;
  }

  function htmlToMarkdown(html) {
    const root = document.createElement('div');
    root.innerHTML = sanitizeHtml(html || '');
    normalizeEditorDom(root);

    const markdown = Array.from(root.childNodes)
      .map((node) => nodeToMarkdown(node, { listDepth: 0 }))
      .join('')
      .replace(/\u00a0/g, ' ');

    return cleanupMarkdown(markdown);
  }

  function normalizeEditorDom(root) {
    root.querySelectorAll('br[data-ghx-temp]').forEach((node) => node.remove());
    root.querySelectorAll(`span.${EXT_NS}-task-box`).forEach((node) => {
      const checkbox = node.querySelector(`input.${EXT_NS}-task-checkbox`);
      const listItem = node.closest('li');
      if (checkbox && listItem) {
        listItem.dataset.task = checkbox.checked ? 'done' : 'todo';
      }
      node.remove();
    });
  }

  function nodeToMarkdown(node, context) {
    if (node.nodeType === Node.TEXT_NODE) {
      return collapseText(node.nodeValue || '', context?.inPre);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const childText = () => Array.from(node.childNodes).map((child) => nodeToMarkdown(child, context)).join('');

    if (tag === 'br') return context?.inPre ? '\n' : '  \n';
    if (tag === 'hr') return '\n---\n\n';

    if (tag === 'pre') {
      const codeNode = node.querySelector('code');
      const lang = codeNode?.getAttribute('data-lang') || '';
      const content = (codeNode?.textContent ?? node.textContent ?? '').replace(/\n+$/, '');
      return `\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
    }

    if (tag === 'code') return `\`${node.textContent || ''}\``;
    if (tag === 'strong' || tag === 'b') return `**${childText()}**`;
    if (tag === 'em' || tag === 'i') return `*${childText()}*`;
    if (tag === 'del' || tag === 's') return `~~${childText()}~~`;

    if (tag === 'a') {
      const text = childText().trim() || (node.textContent || '').trim() || 'link';
      const href = node.getAttribute('href') || '';
      return href ? `[${text}](${href})` : text;
    }

    if (tag === 'img') {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      return src ? `![${alt}](${src})` : '';
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      return `${'#'.repeat(level)} ${childText().trim()}\n\n`;
    }

    if (tag === 'blockquote') {
      const inner = cleanupMarkdown(childText()).trim();
      const quoted = inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
      return `${quoted}\n\n`;
    }

    if (tag === 'ul' || tag === 'ol') {
      const ordered = tag === 'ol';
      const items = Array.from(node.children).filter((child) => child.tagName && child.tagName.toLowerCase() === 'li');
      const block = items.map((item, index) => listItemToMarkdown(item, ordered, index + 1, context.listDepth || 0)).join('\n');
      return `${block}\n\n`;
    }

    if (tag === 'table') {
      return tableToMarkdown(node) + '\n\n';
    }

    if (tag === 'p') {
      const text = childText().trim();
      return text ? `${text}\n\n` : '\n';
    }

    if (tag === 'div') {
      const hasBlockChildren = Array.from(node.children).some((child) => /^(div|p|pre|blockquote|ul|ol|table|h[1-6]|hr)$/i.test(child.tagName));
      const text = childText().trim();
      if (hasBlockChildren) return `${childText()}\n`;
      return text ? `${text}\n\n` : '\n';
    }

    if (tag === 'li') {
      return listItemToMarkdown(node, false, 1, context.listDepth || 0);
    }

    return childText();
  }

  function listItemToMarkdown(li, ordered, index, depth) {
    const prefix = ordered ? `${index}. ` : '- ';
    let taskPrefix = '';
    const checkbox = li.querySelector('input[type="checkbox"]');
    if (checkbox) {
      taskPrefix = checkbox.checked ? '[x] ' : '[ ] ';
    } else if (li.dataset.task === 'done') {
      taskPrefix = '[x] ';
    } else if (li.dataset.task === 'todo') {
      taskPrefix = '[ ] ';
    }

    const children = Array.from(li.childNodes).filter((child) => !(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'input'));
    const content = cleanupMarkdown(children.map((child) => nodeToMarkdown(child, { listDepth: depth + 1 })).join('')).trim();
    const lines = content.split('\n');
    const first = `${'  '.repeat(depth)}${prefix}${taskPrefix}${lines[0] || ''}`.trimEnd();
    const rest = lines.slice(1).map((line) => `${'  '.repeat(depth + 1)}${line}`.trimEnd()).join('\n');
    return rest ? `${first}\n${rest}` : first;
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => cleanupMarkdown(cell.textContent || '').trim()));
    if (!rows.length) return '';
    const header = rows[0];
    const divider = header.map(() => '---');
    const body = rows.slice(1);
    const allRows = [header, divider, ...body];
    return allRows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  }

  function collapseText(text, inPre = false) {
    if (inPre) return text;
    return text.replace(/[\t ]+/g, ' ');
  }

  function cleanupMarkdown(markdown) {
    return String(markdown || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
  }

  function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const allowedTags = new Set([
      'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
    ]);
    const allowedAttributes = new Set(['href', 'src', 'alt', 'title', 'target', 'rel', 'data-lang', 'data-task']);

    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);
    const toStrip = [];

    while (walker.nextNode()) {
      const el = walker.currentNode;
      const tag = el.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        toStrip.push(el);
        continue;
      }

      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          return;
        }
        if (!allowedAttributes.has(name)) {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === 'href' || name === 'src') {
          const clean = safeUrl(attr.value);
          if (clean) {
            el.setAttribute(attr.name, clean);
          } else {
            el.removeAttribute(attr.name);
          }
        }
      });
    }

    toStrip.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });

    return template.innerHTML;
  }

  function decorateTaskLists(root) {
    root.querySelectorAll(`span.${EXT_NS}-task-box`).forEach((node) => node.remove());

    root.querySelectorAll('li[data-task]').forEach((item) => {
      const checked = item.dataset.task === 'done';
      const box = document.createElement('span');
      box.className = `${EXT_NS}-task-box`;
      box.contentEditable = 'false';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = `${EXT_NS}-task-checkbox`;
      checkbox.checked = checked;
      checkbox.setAttribute('aria-label', checked ? '已完成 task' : '未完成 task');

      box.appendChild(checkbox);
      item.insertBefore(box, item.firstChild);
    });
  }

  function safeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (raw.startsWith('#') || raw.startsWith('/')) return raw;
    try {
      const parsed = new URL(raw, window.location.origin);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return parsed.href;
      return '';
    } catch {
      return '';
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function ensureWideToggle() {
    if (wideToggleEl?.isConnected) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${EXT_NS}-wide-toggle`;
    button.addEventListener('click', async () => {
      currentWideMode = !currentWideMode;
      applyWideMode(currentWideMode);
      await saveWideMode(currentWideMode);
    });
    document.documentElement.appendChild(button);
    wideToggleEl = button;
    updateWideToggleLabel();
  }

  function applyWideMode(enabled) {
    currentWideMode = Boolean(enabled);
    document.documentElement.classList.toggle(`${EXT_NS}-wide-mode`, currentWideMode);
    updateWideToggleLabel();
  }

  function updateWideToggleLabel() {
    if (!wideToggleEl) return;
    wideToggleEl.textContent = `寬版：${currentWideMode ? '開' : '關'}`;
    wideToggleEl.title = `寬版閱讀：${currentWideMode ? '開' : '關'} · v${EXT_VERSION}`;
    wideToggleEl.setAttribute('aria-label', wideToggleEl.title);
    wideToggleEl.classList.toggle('is-on', currentWideMode);
    wideToggleEl.classList.toggle('is-off', !currentWideMode);
  }

  function saveWideMode(value) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync) return resolve();
      chrome.storage.sync.set({ [STORAGE_KEYS.wideMode]: Boolean(value) }, () => resolve());
    });
  }

  function loadWideMode() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync) return resolve(true);
      chrome.storage.sync.get({ [STORAGE_KEYS.wideMode]: true }, (result) => {
        resolve(Boolean(result[STORAGE_KEYS.wideMode]));
      });
    });
  }

  async function initWideMode() {
    const saved = await loadWideMode();
    applyWideMode(saved);
  }

  function initObservers() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          if (mutation.addedNodes.length || mutation.removedNodes.length) {
            scheduleScan();
            break;
          }
        }
      }
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    ['turbo:load', 'turbo:frame-load', 'pjax:end', 'readystatechange', 'popstate'].forEach((eventName) => {
      window.addEventListener(eventName, scheduleScan, { passive: true });
      document.addEventListener(eventName, scheduleScan, { passive: true });
    });
  }

  async function init() {
    await initWideMode();
    ensureWideToggle();
    initObservers();
    scheduleScan();
  }

  init();
})();

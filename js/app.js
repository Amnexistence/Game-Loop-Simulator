(function () {
  'use strict';

  const Expression = window.GLExpression;
  const Engine = window.GLEngine;
  const Store = window.GLStore;

  if (!Expression || !Engine || !Store) {
    document.body.innerHTML = '<div style="padding:30px;font:14px Segoe UI;color:#fff;background:#0b0f14">Не удалось загрузить модули LoopLab.</div>';
    return;
  }

  const NODE_W = 216;
  const NODE_H = 108;
  const TICK_MS = 1000;
  const MAX_LOG = 260;
  const EPSILON = 0.000001;

  const dom = {
    pageSelect: document.getElementById('pageSelect'),
    addPageBtn: document.getElementById('addPageBtn'),
    deletePageBtn: document.getElementById('deletePageBtn'),
    saveState: document.getElementById('saveState'),
    helpBtn: document.getElementById('helpBtn'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    clearPageBtn: document.getElementById('clearPageBtn'),
    runBtn: document.getElementById('runBtn'),
    runLabel: document.getElementById('runLabel'),
    stepBtn: document.getElementById('stepBtn'),
    resetBtn: document.getElementById('resetBtn'),
    simStatus: document.getElementById('simStatus'),
    tickCounter: document.getElementById('tickCounter'),
    entityCounter: document.getElementById('entityCounter'),
    speedButtons: document.getElementById('speedButtons'),
    clearInfluenceBtn: document.getElementById('clearInfluenceBtn'),
    entityCount: document.getElementById('entityCount'),
    nodeCount: document.getElementById('nodeCount'),
    entityList: document.getElementById('entityList'),
    nodeList: document.getElementById('nodeList'),
    addEntityBtn: document.getElementById('addEntityBtn'),
    addNodeBtn: document.getElementById('addNodeBtn'),
    graph: document.getElementById('graph'),
    edgeViewport: document.getElementById('edgeViewport'),
    nodeLayer: document.getElementById('nodeLayer'),
    entityLayer: document.getElementById('entityLayer'),
    emptyState: document.getElementById('emptyState'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    fitBtn: document.getElementById('fitBtn'),
    console: document.getElementById('console'),
    consoleToggleBtn: document.getElementById('consoleToggleBtn'),
    consoleLive: document.getElementById('consoleLive'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    eventLog: document.getElementById('eventLog'),
    eventCount: document.getElementById('eventCount'),
    inspector: document.getElementById('inspector'),
    modalRoot: document.getElementById('modalRoot'),
    toastRoot: document.getElementById('toastRoot')
  };

  let firstRun = false;
  try {
    firstRun = !localStorage.getItem(Store.STORAGE_KEY);
  } catch (error) {
    firstRun = true;
  }

  const loadedState = Store.loadState();
  const state = loadedState || Store.createInitialState();

  let sim = null;
  let simulationRunning = false;
  let runTimer = null;
  let eventLog = [];
  let selection = { type: null, id: null };
  let view = { x: 0, y: 0, scale: 1 };
  let activePulses = [];
  let pulseRaf = null;
  let lastFormulaInput = null;
  let dragState = null;
  let panState = null;
  let saveTimer = null;
  let saveStatusTimer = null;
  let consoleCollapsed = false;
  let modalConfirmHandler = null;
  let emptyStateSignature = '';

  function getPage() {
    return state.pages.find(function (page) { return page.id === state.activePageId; }) || state.pages[0] || null;
  }

  function getEntity(page, id) {
    return (page.entities || []).find(function (entity) { return entity.id === id; }) || null;
  }

  function getNode(page, id) {
    return (page.nodes || []).find(function (node) { return node.id === id; }) || null;
  }

  function getSelectedEntity() {
    const page = getPage();
    return selection.type === 'entity' && page ? getEntity(page, selection.id) : null;
  }

  function getSelectedNode() {
    const page = getPage();
    return selection.type === 'node' && page ? getNode(page, selection.id) : null;
  }

  function getSimEntity(entityId) {
    return sim ? sim.entities.find(function (entity) { return entity.id === entityId; }) || null : null;
  }

  function getInfluence(nodeId) {
    if (!sim) return 0;
    return sim.influences[nodeId] ? sim.influences[nodeId].total : 0;
  }

  function getInfluenceData(nodeId) {
    if (!sim) return { total: 0, byName: {}, bySource: {} };
    return sim.influences[nodeId] || { total: 0, byName: {}, bySource: {} };
  }

  function getCurrentNodeId(entity) {
    const runtime = getSimEntity(entity.id);
    if (runtime && runtime.currentId) return runtime.currentId;
    const page = getPage();
    if (entity.startNodeId && getNode(page, entity.startNodeId)) return entity.startNodeId;
    return page && page.nodes.length ? page.nodes[0].id : null;
  }

  function displayName(value, fallback) {
    const text = value == null ? '' : String(value).trim();
    return text || fallback || 'Без названия';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function format(value, digits) {
    return Expression.formatNumber(value, digits == null ? 2 : digits);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function findNodeElement(id) {
    return Array.from(dom.nodeLayer.querySelectorAll('.node-card')).find(function (element) {
      return element.dataset.nodeId === id;
    }) || null;
  }

  function findEntityElement(id) {
    return Array.from(dom.entityLayer.querySelectorAll('.entity-token')).find(function (element) {
      return element.dataset.entityId === id;
    }) || null;
  }

  function linkCount(page) {
    return page.nodes.reduce(function (total, node) {
      return total + (node.links ? node.links.length : 0);
    }, 0);
  }

  function setSaveStatus(type, text) {
    if (!dom.saveState) return;
    dom.saveState.classList.remove('is-saving', 'is-error');
    if (type === 'saving') dom.saveState.classList.add('is-saving');
    if (type === 'error') dom.saveState.classList.add('is-error');
    const label = dom.saveState.querySelector('span');
    if (label) label.textContent = text || (type === 'saving' ? 'Сохранение' : type === 'error' ? 'Ошибка' : 'Сохранено');
    clearTimeout(saveStatusTimer);
    if (type === 'saved') {
      saveStatusTimer = setTimeout(function () {
        if (dom.saveState) {
          dom.saveState.classList.remove('is-saving', 'is-error');
          const current = dom.saveState.querySelector('span');
          if (current) current.textContent = 'Сохранено';
        }
      }, 2600);
    }
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      Store.saveState(state);
      setSaveStatus('saved', 'Сохранено');
    } catch (error) {
      console.error('LoopLab: ошибка сохранения', error);
      setSaveStatus('error', 'Нет доступа');
      toast('Не удалось сохранить данные в localStorage: ' + error.message, 'error', 6000);
    }
  }

  function persistSoon() {
    setSaveStatus('saving', 'Сохранение');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 280);
  }

  function buildSpeedButtons() {
    dom.speedButtons.innerHTML = Store.SPEEDS.map(function (speed) {
      return '<button class="speed-btn' + (state.speed === speed ? ' is-active' : '')
        + '" type="button" data-speed="' + speed + '" title="Скорость ' + speed + '×">'
        + String(speed).replace('.', ',') + '×</button>';
    }).join('');
  }

  function updateSpeedButtons() {
    Array.from(dom.speedButtons.querySelectorAll('.speed-btn')).forEach(function (button) {
      button.classList.toggle('is-active', Number(button.dataset.speed) === state.speed);
    });
    const speedStat = dom.inspector.querySelector('[data-page-speed]');
    if (speedStat) speedStat.textContent = String(state.speed).replace('.', ',') + '×';
  }

  function setSpeed(speed) {
    const number = Number(speed);
    if (!Store.SPEEDS.includes(number)) return;
    state.speed = number;
    updateSpeedButtons();
    persistSoon();
    if (simulationRunning) {
      clearTimeout(runTimer);
      scheduleNextTick(TICK_MS / state.speed);
    }
  }

  function renderPageSelect() {
    dom.pageSelect.innerHTML = state.pages.map(function (page) {
      return '<option value="' + escapeAttr(page.id) + '">' + escapeHtml(displayName(page.name, 'Без названия')) + '</option>';
    }).join('');
    dom.pageSelect.value = state.activePageId;
    dom.deletePageBtn.disabled = state.pages.length <= 1;
    dom.deletePageBtn.title = state.pages.length <= 1 ? 'Нельзя удалить единственную схему' : 'Удалить схему';
  }

  function renderLists() {
    const page = getPage();
    if (!page) return;

    dom.entityCount.textContent = page.entities.length;
    dom.nodeCount.textContent = page.nodes.length;

    if (!page.entities.length) {
      dom.entityList.innerHTML = '<div class="list-empty">Пока нет сущностей.<br>Добавьте игрока или другой объект.</div>';
    } else {
      dom.entityList.innerHTML = page.entities.map(function (entity) {
        const current = getCurrentNodeId(entity);
        const node = current ? getNode(page, current) : null;
        const selected = selection.type === 'entity' && selection.id === entity.id;
        return '<button type="button" class="list-item' + (selected ? ' is-selected' : '') + '"'
          + ' data-list-entity="' + escapeAttr(entity.id) + '" style="--item-color:' + escapeAttr(entity.color) + '">'
          + '<span class="item-dot"></span>'
          + '<span class="item-main">'
          + '<span class="item-name">' + escapeHtml(displayName(entity.name, 'Сущность')) + '</span>'
          + '<span class="item-meta">' + entity.params.length + ' пар. · ' + escapeHtml(node ? node.name : 'нет старта') + '</span>'
          + '</span>'
          + '<span class="item-side">' + (sim ? 'live' : '') + '</span>'
          + '</button>';
      }).join('');
    }

    if (!page.nodes.length) {
      dom.nodeList.innerHTML = '<div class="list-empty">Пока нет нод.<br>Создайте первый процесс петли.</div>';
    } else {
      dom.nodeList.innerHTML = page.nodes.map(function (node) {
        const selected = selection.type === 'node' && selection.id === node.id;
        return '<button type="button" class="list-item' + (selected ? ' is-selected' : '') + '"'
          + ' data-list-node="' + escapeAttr(node.id) + '" style="--item-color:' + escapeAttr(node.color) + '">'
          + '<span class="item-dot"></span>'
          + '<span class="item-main">'
          + '<span class="item-name">' + escapeHtml(displayName(node.name, 'Нода')) + '</span>'
          + '<span class="item-meta">' + node.effects.length + ' эфф. · ' + node.links.length + ' св.</span>'
          + '</span>'
          + '<span class="item-side">' + (node.conditions.enabled ? '◈' : '') + '</span>'
          + '</button>';
      }).join('');
    }
  }

  function updateControls() {
    const page = getPage();
    const running = simulationRunning && Boolean(sim);

    dom.runBtn.classList.toggle('is-running', running);
    dom.runLabel.textContent = running ? 'Пауза' : 'Запустить';
    dom.runBtn.setAttribute('aria-label', running ? 'Поставить симуляцию на паузу' : 'Запустить симуляцию');

    dom.simStatus.classList.toggle('is-running', running);
    dom.simStatus.classList.toggle('is-idle', !running);
    const statusLabel = dom.simStatus.querySelector('span');
    if (statusLabel) statusLabel.textContent = running ? 'Симуляция' : (sim && sim.tick > 0 ? 'Пауза' : 'Готова');

    dom.tickCounter.textContent = sim ? format(sim.tick, 0) : '0';
    dom.entityCounter.textContent = page ? page.entities.length : 0;
    dom.consoleLive.classList.toggle('is-live', running);
    dom.clearInfluenceBtn.disabled = !sim;
    dom.deletePageBtn.disabled = state.pages.length <= 1;
    updateSpeedButtons();
  }

  function selectItem(type, id) {
    const page = getPage();
    if (!page) return;
    if (type === 'node' && !getNode(page, id)) return;
    if (type === 'entity' && !getEntity(page, id)) return;
    selection = { type: type, id: id };
    renderLists();
    renderEdges();
    updateSelectionVisuals();
    renderInspector();
    updateEntityPositions();
  }

  function clearSelection() {
    selection = { type: null, id: null };
    renderLists();
    renderEdges();
    updateSelectionVisuals();
    renderInspector();
  }

  function stopSimulation(silent) {
    simulationRunning = false;
    clearTimeout(runTimer);
    runTimer = null;
    updateControls();
    if (!silent && sim) {
      pushSystemEvent('Симуляция остановлена', 'muted');
    }
  }

  function getFormulaPreview(formula, nodeId) {
    const page = getPage();
    const entity = page && page.entities.length ? page.entities[0] : null;
    if (!entity || !formula) return '';
    const runtime = getSimEntity(entity.id);
    const vars = {
      cycle: sim ? sim.tick : 0,
      tick: sim ? sim.tick : 0,
      visits: runtime ? runtime.visits : 0,
      influence: nodeId ? getInfluence(nodeId) : 0
    };
    (entity.params || []).forEach(function (param) {
      vars[param.name] = runtime && Object.prototype.hasOwnProperty.call(runtime.params, param.id)
        ? runtime.params[param.id]
        : param.value;
    });
    try {
      return '≈ ' + format(Expression.evaluate(formula, vars), 2);
    } catch (error) {
      return '';
    }
  }

  function formulaState(formula, nodeId) {
    const result = Expression.validate(formula);
    if (!result.ok) return { ok: false, error: result.error, preview: '' };
    return { ok: true, error: '', preview: getFormulaPreview(formula, nodeId) };
  }

  function pushSystemEvent(text, tone) {
    appendLogEvents([{
      kind: 'system',
      tone: tone || 'muted',
      text: text,
      tick: sim ? sim.tick : 0
    }]);
  }

  function collectEntityPositions(page) {
    const result = new Map();
    if (!page) return result;

    const items = sim
      ? sim.entities.map(function (runtime) {
        const entity = getEntity(page, runtime.id);
        return entity ? { id: entity.id, currentId: runtime.currentId } : null;
      }).filter(Boolean)
      : page.entities.map(function (entity) {
        return { id: entity.id, currentId: getCurrentNodeId(entity) };
      });

    const groups = new Map();
    items.forEach(function (item) {
      if (!item.currentId) return;
      if (!groups.has(item.currentId)) groups.set(item.currentId, []);
      groups.get(item.currentId).push(item.id);
    });

    groups.forEach(function (ids, nodeId) {
      const node = getNode(page, nodeId);
      if (!node) return;
      ids.forEach(function (id, index) {
        const spread = (index - (ids.length - 1) / 2) * 22;
        result.set(id, {
          x: node.x + NODE_W / 2 + spread,
          y: node.y + NODE_H + 10,
          nodeId: nodeId
        });
      });
    });

    return result;
  }

  function renderNodeMarkup(node, page, entityCounts, index) {
    const influence = getInfluence(node.id);
    const selected = selection.type === 'node' && selection.id === node.id;
    const conditionSummary = Engine.describeConditions(node.conditions);
    const description = node.description
      ? '<p class="node-desc" title="' + escapeAttr(node.description) + '">' + escapeHtml(node.description) + '</p>'
      : '<p class="node-desc is-empty">без описания</p>';

    return '<div class="node-card' + (selected ? ' is-selected' : '') + '"'
      + ' data-node-id="' + escapeAttr(node.id) + '"'
      + ' style="--node-color:' + escapeAttr(node.color) + ';transform:translate(' + node.x + 'px,' + node.y + 'px)"'
      + ' role="button" tabindex="0" aria-label="Нода ' + escapeAttr(displayName(node.name, 'Нода')) + '">'
      + '<div class="node-inner">'
      + '<div class="node-topline">'
      + '<span class="node-dot"></span>'
      + '<span class="node-title">' + escapeHtml(displayName(node.name, 'Нода')) + '</span>'
      + '<span class="node-index">' + String(index + 1).padStart(2, '0') + '</span>'
      + '</div>'
      + description
      + '<div class="node-stats">'
      + '<span class="node-stat influence' + (Math.abs(influence) > EPSILON ? ' has-influence' : '') + '" title="Накопленное входящее влияние">'
      + '<span>◈</span><b data-node-influence>' + format(influence, 1) + '</b></span>'
      + '<span class="node-stat" title="Эффекты на параметры сущностей"><span>✦</span><b>' + node.effects.length + '</b></span>'
      + '<span class="node-stat" title="Исходящие связи"><span>→</span><b>' + node.links.length + '</b></span>'
      + (node.conditions.enabled
        ? '<span class="node-stat condition" title="' + escapeAttr(conditionSummary) + '">'
          + '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.7 12 3.8v3.4c0 2.7-2.1 4.5-5 5.2-2.9-.7-5-2.5-5-5.2V3.8L7 1.7Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
          + '</span>'
        : '')
      + '<span class="node-flow"><span class="node-entities-count" data-node-entities title="Сущностей в ноде">'
      + (entityCounts[node.id] || 0) + '</span></span>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderEntityMarkup(entity, position) {
    if (!position) return '';
    const selected = selection.type === 'entity' && selection.id === entity.id;
    return '<div class="entity-token' + (selected ? ' is-selected' : '') + '"'
      + ' data-entity-id="' + escapeAttr(entity.id) + '"'
      + ' style="--entity-color:' + escapeAttr(entity.color) + ';transform:translate3d(' + position.x + 'px,' + position.y + 'px,0)"'
      + ' title="' + escapeAttr(displayName(entity.name, 'Сущность')) + '">'
      + '<span class="entity-tooltip">' + escapeHtml(displayName(entity.name, 'Сущность')) + '</span>'
      + '</div>';
  }

  function renderGraph() {
    const page = getPage();
    if (!page) return;

    const positions = collectEntityPositions(page);
    const entityCounts = {};
    positions.forEach(function (position) {
      entityCounts[position.nodeId] = (entityCounts[position.nodeId] || 0) + 1;
    });

    dom.nodeLayer.innerHTML = page.nodes.map(function (node, index) {
      return renderNodeMarkup(node, page, entityCounts, index);
    }).join('');

    dom.entityLayer.innerHTML = page.entities.map(function (entity) {
      return renderEntityMarkup(entity, positions.get(entity.id));
    }).join('');

    renderEdges();
    updateEntityPositions();
    updateGraphRuntime();
    updateEmptyState();
    updateSelectionVisuals();
    applyView();
  }

  function borderPoint(node, targetX, targetY) {
    const cx = node.x + NODE_W / 2;
    const cy = node.y + NODE_H / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const adx = Math.abs(dx) || 0.000001;
    const ady = Math.abs(dy) || 0.000001;
    const scale = Math.min((NODE_W / 2 + 3) / adx, (NODE_H / 2 + 3) / ady);
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  function edgeGeometry(source, target) {
    const sourceCenter = { x: source.x + NODE_W / 2, y: source.y + NODE_H / 2 };
    const targetCenter = { x: target.x + NODE_W / 2, y: target.y + NODE_H / 2 };
    const start = borderPoint(source, targetCenter.x, targetCenter.y);
    const end = borderPoint(target, sourceCenter.x, sourceCenter.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const nx = -dy / distance;
    const ny = dx / distance;
    const bend = clamp(distance * 0.075, 6, 36);
    const control = {
      x: (start.x + end.x) / 2 + nx * bend,
      y: (start.y + end.y) / 2 + ny * bend
    };
    const label = {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x + nx * 9,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y + ny * 9
    };
    return {
      d: 'M ' + start.x.toFixed(2) + ' ' + start.y.toFixed(2)
        + ' Q ' + control.x.toFixed(2) + ' ' + control.y.toFixed(2)
        + ' ' + end.x.toFixed(2) + ' ' + end.y.toFixed(2),
      label: label
    };
  }

  function renderEdges() {
    const page = getPage();
    if (!page) {
      dom.edgeViewport.innerHTML = '';
      return;
    }

    const markup = [];
    page.nodes.forEach(function (source) {
      (source.links || []).forEach(function (link) {
        const target = getNode(page, link.targetId);
        if (!target) return;
        const geometry = edgeGeometry(source, target);
        const names = (link.influences || []).map(function (influence) {
          return displayName(influence.name, 'влияние');
        });
        const fullLabel = names.length ? names.join(' · ') : 'переход';
        const shortLabel = fullLabel.length > 34 ? fullLabel.slice(0, 31) + '…' : fullLabel;
        const selected = selection.type === 'node'
          && (selection.id === source.id || selection.id === target.id);
        const title = displayName(source.name, 'Нода') + ' → ' + displayName(target.name, 'Нода')
          + ': ' + (names.length ? names.join(', ') : 'только переход');

        markup.push('<path class="edge-path' + (selected ? ' is-selected' : '') + '"'
          + ' data-link-id="' + escapeAttr(link.id) + '"'
          + ' data-source-id="' + escapeAttr(source.id) + '"'
          + ' data-target-id="' + escapeAttr(target.id) + '"'
          + ' d="' + geometry.d + '" marker-end="url(#edgeArrow)">'
          + '<title>' + escapeHtml(title) + '</title>'
          + '</path>');
        markup.push('<text class="edge-label' + (selected ? ' is-selected' : '') + '"'
          + ' x="' + geometry.label.x.toFixed(2) + '" y="' + geometry.label.y.toFixed(2) + '"'
          + ' text-anchor="middle">' + escapeHtml(shortLabel) + '</text>');
      });
    });

    dom.edgeViewport.innerHTML = markup.join('');
  }

  function applyView() {
    const transform = 'translate(' + view.x.toFixed(2) + 'px,' + view.y.toFixed(2) + 'px) scale(' + view.scale.toFixed(4) + ')';
    dom.nodeLayer.style.transform = transform;
    dom.entityLayer.style.transform = transform;
    dom.edgeViewport.setAttribute('transform',
      'translate(' + view.x.toFixed(2) + ' ' + view.y.toFixed(2) + ') scale(' + view.scale.toFixed(4) + ')');
    const grid = 28 * view.scale;
    dom.graph.style.backgroundSize = grid.toFixed(2) + 'px ' + grid.toFixed(2) + 'px, '
      + grid.toFixed(2) + 'px ' + grid.toFixed(2) + 'px, 100% 100%';
    dom.graph.style.backgroundPosition = view.x.toFixed(2) + 'px ' + view.y.toFixed(2) + 'px, '
      + view.x.toFixed(2) + 'px ' + view.y.toFixed(2) + 'px, center';
  }

  function updateEntityPositions() {
    const page = getPage();
    if (!page) return;
    const positions = collectEntityPositions(page);
    const counts = {};

    positions.forEach(function (position, entityId) {
      counts[position.nodeId] = (counts[position.nodeId] || 0) + 1;
      const token = findEntityElement(entityId);
      if (token) {
        token.style.transform = 'translate3d(' + position.x + 'px,' + position.y + 'px,0)';
      }
    });

    Array.from(dom.nodeLayer.querySelectorAll('.node-card')).forEach(function (card) {
      const count = counts[card.dataset.nodeId] || 0;
      const badge = card.querySelector('[data-node-entities]');
      if (badge) badge.textContent = count;
    });
  }

  function updateEntityListRuntime() {
    const page = getPage();
    if (!page) return;
    Array.from(dom.entityList.querySelectorAll('[data-list-entity]')).forEach(function (item) {
      const entity = getEntity(page, item.dataset.listEntity);
      if (!entity) return;
      const current = getCurrentNodeId(entity);
      const node = current ? getNode(page, current) : null;
      const meta = item.querySelector('.item-meta');
      if (meta) meta.textContent = entity.params.length + ' пар. · ' + (node ? displayName(node.name, 'Нода') : 'нет старта');
      const side = item.querySelector('.item-side');
      if (side) side.textContent = sim ? 'live' : '';
    });
  }

  function updateGraphRuntime() {
    const page = getPage();
    if (!page) return;

    (page.nodes || []).forEach(function (node) {
      const card = findNodeElement(node.id);
      if (!card) return;
      const influence = getInfluence(node.id);
      const value = card.querySelector('[data-node-influence]');
      if (value) value.textContent = format(influence, 1);
      const stat = card.querySelector('.node-stat.influence');
      if (stat) stat.classList.toggle('has-influence', Math.abs(influence) > EPSILON);
    });

    updateEntityPositions();
    updateEntityListRuntime();
    updateEmptyState();
  }

  function updateSelectionVisuals() {
    Array.from(dom.nodeLayer.querySelectorAll('.node-card')).forEach(function (card) {
      card.classList.toggle('is-selected', selection.type === 'node' && card.dataset.nodeId === selection.id);
    });
    Array.from(dom.entityLayer.querySelectorAll('.entity-token')).forEach(function (token) {
      token.classList.toggle('is-selected', selection.type === 'entity' && token.dataset.entityId === selection.id);
    });
  }

  function updateEmptyState() {
    const page = getPage();
    if (!page) return;
    const hidden = page.nodes.length > 0;
    if (hidden) {
      dom.emptyState.setAttribute('hidden', '');
      return;
    }

    dom.emptyState.removeAttribute('hidden');
    const hasEntities = page.entities.length > 0;
    const title = dom.emptyState.querySelector('h2');
    const copy = dom.emptyState.querySelector('p');
    const addNode = dom.emptyState.querySelector('[data-action="empty-add-node"]');
    const addEntity = dom.emptyState.querySelector('[data-action="empty-add-entity"]');
    const signature = hasEntities ? 'entities-only' : 'empty';

    if (signature !== emptyStateSignature) {
      emptyStateSignature = signature;
      if (title) title.textContent = hasEntities ? 'Добавьте первую ноду' : 'Соберите первую петлю';
      if (copy) {
        copy.textContent = hasEntities
          ? 'Сущность уже есть. Создайте ноду процесса и настройте её эффекты и связи.'
          : 'Добавьте сущность, создайте ноды процессов и соедините их связями. Затем запустите симуляцию.';
      }
      if (addEntity) addEntity.style.display = hasEntities ? 'none' : '';
    }
    if (addNode) addNode.style.display = '';
  }

  function flashNode(nodeId) {
    const card = findNodeElement(nodeId);
    if (!card) return;
    card.classList.remove('is-hit');
    void card.offsetWidth;
    card.classList.add('is-hit');
    setTimeout(function () { card.classList.remove('is-hit'); }, 680);
  }

  function showApplicationFloat(application, index) {
    const page = getPage();
    const node = page ? getNode(page, application.nodeId) : null;
    if (!node) return;
    let prefix = '';
    if (application.operation === 'set') prefix = '= ';
    else if (application.operation === 'multiply') prefix = '× ';
    else prefix = application.amount >= 0 ? '+ ' : '− ';
    const value = application.operation === 'add' ? Math.abs(application.amount) : application.amount;
    const label = document.createElement('div');
    label.className = 'float-label ' + (application.amount >= 0 ? 'positive' : 'negative');
    label.textContent = application.paramName + ': ' + prefix + format(value, 2);
    label.style.left = (node.x + NODE_W / 2 + ((index % 3) - 1) * 22) + 'px';
    label.style.top = (node.y + 26 + (index % 4) * 11) + 'px';
    dom.nodeLayer.appendChild(label);
    setTimeout(function () {
      if (label.parentNode) label.parentNode.removeChild(label);
    }, 1350);
  }

  function spawnPulse(pulse) {
    const page = getPage();
    if (!page) return;
    const path = Array.from(dom.edgeViewport.querySelectorAll('.edge-path')).find(function (element) {
      return element.dataset.linkId === pulse.linkId;
    });
    if (!path) return;

    const source = getNode(page, pulse.sourceId);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '3.1');
    circle.setAttribute('fill', source ? source.color : '#b8f36b');
    circle.setAttribute('opacity', '0.95');
    circle.classList.add('pulse-dot');
    dom.edgeViewport.appendChild(circle);

    let length = 0;
    try {
      length = path.getTotalLength();
    } catch (error) {
      length = 0;
    }
    if (!length) {
      if (circle.parentNode) circle.parentNode.removeChild(circle);
      return;
    }

    path.classList.add('is-flashing');
    setTimeout(function () { path.classList.remove('is-flashing'); }, 560);
    setTimeout(function () { flashNode(pulse.targetId); }, 500);

    activePulses.push({
      element: circle,
      path: path,
      length: length,
      started: performance.now(),
      duration: 620
    });
    startPulseAnimation();
  }

  function startPulseAnimation() {
    if (pulseRaf) return;
    const frame = function (now) {
      activePulses = activePulses.filter(function (pulse) {
        const progress = clamp((now - pulse.started) / pulse.duration, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        try {
          const point = pulse.path.getPointAtLength(pulse.length * eased);
          pulse.element.setAttribute('cx', point.x);
          pulse.element.setAttribute('cy', point.y);
          pulse.element.setAttribute('opacity', String(0.95 - progress * 0.25));
        } catch (error) {
          // The edge was rebuilt during animation.
        }
        if (progress >= 1) {
          if (pulse.element.parentNode) pulse.element.parentNode.removeChild(pulse.element);
          return false;
        }
        return true;
      });

      if (activePulses.length) {
        pulseRaf = requestAnimationFrame(frame);
      } else {
        pulseRaf = null;
      }
    };
    pulseRaf = requestAnimationFrame(frame);
  }

  function animateSimulationResult(result) {
    result.applications.forEach(function (application, index) {
      showApplicationFloat(application, index);
      flashNode(application.nodeId);
    });
    result.pulses.forEach(function (pulse) {
      spawnPulse(pulse);
    });
  }

  function fitGraph() {
    const page = getPage();
    if (!page) return;
    const rect = dom.graph.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    if (!page.nodes.length) {
      view = { x: 0, y: 0, scale: 1 };
      applyView();
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    page.nodes.forEach(function (node) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_W);
      maxY = Math.max(maxY, node.y + NODE_H + 28);
    });

    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const padding = 64;
    const scale = clamp(Math.min(
      (rect.width - padding * 2) / width,
      (rect.height - padding * 2) / height
    ), 0.28, 1.15);

    view = {
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: (rect.height - height * scale) / 2 - minY * scale,
      scale: scale
    };
    applyView();
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = dom.graph.getBoundingClientRect();
    const sx = (clientX == null ? rect.width / 2 : clientX - rect.left);
    const sy = (clientY == null ? rect.height / 2 : clientY - rect.top);
    const worldX = (sx - view.x) / view.scale;
    const worldY = (sy - view.y) / view.scale;
    const nextScale = clamp(view.scale * factor, 0.28, 2.6);
    view.x = sx - worldX * nextScale;
    view.y = sy - worldY * nextScale;
    view.scale = nextScale;
    applyView();
  }

  function screenToWorld(clientX, clientY) {
    const rect = dom.graph.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale
    };
  }

  function onGraphPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.node-card, .entity-token, button, .empty-state, .graph-tools, .graph-legend')) return;

    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y
    };
    dom.graph.classList.add('is-panning');
    if (dom.graph.setPointerCapture) {
      try { dom.graph.setPointerCapture(event.pointerId); } catch (error) { /* noop */ }
    }
  }

  function onNodePointerDown(event) {
    if (event.button !== 0) return;
    const card = event.target.closest('.node-card');
    if (!card) return;
    const page = getPage();
    const node = page ? getNode(page, card.dataset.nodeId) : null;
    if (!node) return;

    event.preventDefault();
    event.stopPropagation();
    selectItem('node', node.id);

    dragState = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      moved: false
    };
    card.classList.add('is-dragging');
    if (dom.nodeLayer.setPointerCapture) {
      try { dom.nodeLayer.setPointerCapture(event.pointerId); } catch (error) { /* noop */ }
    }
  }

  function onEntityPointerDown(event) {
    if (event.button !== 0) return;
    const token = event.target.closest('.entity-token');
    if (!token) return;
    event.preventDefault();
    event.stopPropagation();
    selectItem('entity', token.dataset.entityId);
  }

  function onPointerMove(event) {
    if (panState && panState.pointerId === event.pointerId) {
      view.x = panState.viewX + (event.clientX - panState.startX);
      view.y = panState.viewY + (event.clientY - panState.startY);
      applyView();
      return;
    }

    if (dragState && dragState.pointerId === event.pointerId) {
      const page = getPage();
      const node = page ? getNode(page, dragState.nodeId) : null;
      if (!node) return;
      const dx = (event.clientX - dragState.startX) / view.scale;
      const dy = (event.clientY - dragState.startY) / view.scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragState.moved = true;
      node.x = Math.round(dragState.nodeX + dx);
      node.y = Math.round(dragState.nodeY + dy);
      const card = findNodeElement(node.id);
      if (card) card.style.transform = 'translate(' + node.x + 'px,' + node.y + 'px)';
      renderEdges();
      updateEntityPositions();
    }
  }

  function onPointerUp(event) {
    if (panState && panState.pointerId === event.pointerId) {
      panState = null;
      dom.graph.classList.remove('is-panning');
    }
    if (dragState && dragState.pointerId === event.pointerId) {
      const card = findNodeElement(dragState.nodeId);
      if (card) card.classList.remove('is-dragging');
      if (dragState.moved) persistSoon();
      dragState = null;
    }
  }

  function onGraphWheel(event) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAt(event.clientX, event.clientY, factor);
  }

  function refreshGraphAndLists() {
    renderLists();
    renderGraph();
    updateControls();
  }

  function renderInspector() {
    const page = getPage();
    if (!page) {
      dom.inspector.innerHTML = '';
      return;
    }

    if (selection.type === 'node' && !getNode(page, selection.id)) {
      selection = { type: null, id: null };
    }
    if (selection.type === 'entity' && !getEntity(page, selection.id)) {
      selection = { type: null, id: null };
    }

    if (selection.type === 'node') {
      dom.inspector.innerHTML = renderNodeInspector(page, getNode(page, selection.id));
      return;
    }
    if (selection.type === 'entity') {
      dom.inspector.innerHTML = renderEntityInspector(page, getEntity(page, selection.id));
      return;
    }
    dom.inspector.innerHTML = renderPageInspector(page);
  }

  function rerenderInspectorPreserveScroll() {
    const scroll = dom.inspector.scrollTop;
    renderInspector();
    dom.inspector.scrollTop = scroll;
  }

  function inspectorHead(eyebrow, title, subtitle, action) {
    return '<div class="inspector-head">'
      + '<div><span class="eyebrow">' + escapeHtml(eyebrow) + '</span>'
      + '<h2 data-inspector-title>' + escapeHtml(displayName(title, 'Без названия')) + '</h2>'
      + '<p data-inspector-subtitle>' + subtitle + '</p></div>'
      + (action || '')
      + '</div>';
  }

  function renderPageInspector(page) {
    const nodes = page.nodes.length;
    const entities = page.entities.length;
    const links = linkCount(page);
    return inspectorHead('Схема', displayName(page.name, 'Без названия'),
      entities + ' сущностей · ' + nodes + ' нод · ' + links + ' связей')
      + '<div class="inspector-body">'
      + '<section class="inspector-section">'
      + '<div class="field"><label for="pageNameInput">Название схемы</label>'
      + '<input class="input" id="pageNameInput" data-page-name value="' + escapeAttr(page.name) + '" placeholder="Например, петля игрока"></div>'
      + '<div class="field-hint">Название используется в переключателе схем и при экспорте.</div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="stats-grid">'
      + '<div class="stat-card"><b>' + nodes + '</b><span>нод</span></div>'
      + '<div class="stat-card"><b>' + entities + '</b><span>сущностей</span></div>'
      + '<div class="stat-card"><b>' + links + '</b><span>связей</span></div>'
      + '<div class="stat-card"><b data-page-speed>' + state.speed.toString().replace('.', ',') + '×</b><span>скорость</span></div>'
      + '</div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Быстрый старт</h3></div>'
      + '<ol class="guide-list">'
      + '<li><span class="step-num">1</span><span>Добавьте сущность и её стартовые параметры.</span></li>'
      + '<li><span class="step-num">2</span><span>Создайте ноды процессов: что происходит на каждом этапе.</span></li>'
      + '<li><span class="step-num">3</span><span>Соедините ноды связями и настройте влияния.</span></li>'
      + '<li><span class="step-num">4</span><span>Запустите симуляцию и наблюдайте за петлёй.</span></li>'
      + '</ol>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Редактор схемы</h3></div>'
      + '<div class="field-row">'
      + '<button class="primary-btn full-btn" type="button" data-action="add-entity">+ Сущность</button>'
      + '<button class="secondary-btn full-btn" type="button" data-action="add-node">+ Нода</button>'
      + '</div>'
      + '<div class="field-hint" style="margin-top:8px">Одна нода = один этап петли. Связь одновременно задаёт переход к следующей ноде и передаёт влияние.</div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="field-hint">Данные автоматически сохраняются в localStorage. Экспорт создаёт JSON-резервную копию всех схем.</div>'
      + '</section>'
      + '</div>';
  }

  function renderEntityInspector(page, entity) {
    if (!entity) return '';
    const currentId = sim ? getCurrentNodeId(entity) : null;
    const currentNode = currentId ? getNode(page, currentId) : null;
    const runtime = getSimEntity(entity.id);

    const startOptions = page.nodes.length
      ? '<option value="">— выберите ноду —</option>' + page.nodes.map(function (node) {
        return '<option value="' + escapeAttr(node.id) + '"' + (entity.startNodeId === node.id ? ' selected' : '') + '>'
          + escapeHtml(displayName(node.name, 'Нода')) + '</option>';
      }).join('')
      : '<option value="">Сначала добавьте ноду</option>';

    const paramRows = entity.params.length
      ? entity.params.map(function (param) {
        return '<div class="param-row">'
          + '<input class="input" data-param-id="' + escapeAttr(param.id) + '" data-param-name value="' + escapeAttr(param.name) + '" title="Имя переменной">'
          + '<input class="input" type="number" step="any" data-param-id="' + escapeAttr(param.id) + '" data-param-value value="' + escapeAttr(param.value) + '" title="Стартовое значение">'
          + '<button class="icon-remove" type="button" data-action="remove-param" data-param-id="' + escapeAttr(param.id) + '" title="Удалить параметр">'
          + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
          + '</button>'
          + '</div>';
      }).join('')
      : '<div class="empty-inline">Параметров пока нет. Добавьте, например, <b>hp</b>, <b>gold</b> или <b>energy</b>.</div>';

    const liveParams = runtime
      ? entity.params.map(function (param) {
        const value = Object.prototype.hasOwnProperty.call(runtime.params, param.id) ? runtime.params[param.id] : param.value;
        return '<div class="live-source-row"><span>' + escapeHtml(param.name) + '</span>'
          + '<b data-live-param="' + escapeAttr(param.id) + '">' + format(value, 3) + '</b></div>';
      }).join('')
      : '';

    return inspectorHead('Сущность', entity.name,
      entity.params.length + ' параметров · ' + escapeHtml(currentNode ? currentNode.name : 'старт не задан'),
      '<button class="icon-remove" type="button" data-action="delete-entity" title="Удалить сущность">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>')
      + '<div class="inspector-body">'
      + '<section class="inspector-section">'
      + '<div class="name-color-row">'
      + '<div class="field"><label>Имя</label><input class="input" data-entity-name value="' + escapeAttr(entity.name) + '" placeholder="Игрок"></div>'
      + '<div class="field"><label>Цвет</label><input class="input color-input" type="color" data-entity-color value="' + escapeAttr(entity.color) + '"></div>'
      + '</div>'
      + '<div class="field"><label>Стартовая нода</label><select class="select" data-entity-start>'
      + startOptions + '</select>'
      + '<div class="field-hint">С этой ноды сущность начнёт путь после запуска или сброса.</div></div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Параметры</h3>'
      + '<button class="mini-add" type="button" data-action="add-param" title="Добавить параметр">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      + '</button></div>'
      + '<div class="param-list">' + paramRows + '</div>'
      + '<div class="field-hint" style="margin-top:8px">Имена задают переменные для формул: <code>{hp}</code>, <code>{gold}</code>. Переименование меняет переменную.</div>'
      + '</section>'
      + (runtime
        ? '<section class="inspector-section"><div class="section-title-row"><h3>Сейчас в симуляции</h3></div>'
          + '<div class="live-card"><div class="live-total"><b data-live-entity-node>' + escapeHtml(currentNode ? currentNode.name : '—') + '</b><span>текущая нода</span></div>'
          + '<div class="live-sources">' + (liveParams || '<div class="live-source-empty">У сущности нет параметров.</div>') + '</div></div>'
          + '</section>'
        : '')
      + '<section class="danger-zone">'
      + '<button class="danger-btn" type="button" data-action="delete-entity">Удалить сущность</button>'
      + '</section>'
      + '</div>';
  }

  function effectParamOptions(page, selected) {
    const names = Store.paramNames(page);
    if (!names.length) return '<option value="">Нет параметров</option>';
    let markup = '';
    if (selected && !names.includes(selected)) {
      markup += '<option value="' + escapeAttr(selected) + '" selected>⚠ ' + escapeHtml(selected) + ' (нет параметра)</option>';
    }
    markup += names.map(function (name) {
      return '<option value="' + escapeAttr(name) + '"' + (name === selected ? ' selected' : '') + '>'
        + escapeHtml(name) + '</option>';
    }).join('');
    return markup;
  }

  function operationOptions(selected) {
    return [
      ['add', 'Прибавить'],
      ['multiply', 'Умножить'],
      ['set', 'Задать']
    ].map(function (entry) {
      return '<option value="' + entry[0] + '"' + (entry[0] === selected ? ' selected' : '') + '>'
        + entry[1] + '</option>';
    }).join('');
  }

  function formulaFieldMarkup(formula, nodeId) {
    const info = formulaState(formula, nodeId);
    return {
      className: 'input formula-input' + (info.ok ? '' : ' is-invalid'),
      error: escapeHtml(info.error || ''),
      preview: escapeHtml(info.preview || '')
    };
  }

  function renderEffectCard(page, node, effect) {
    const field = formulaFieldMarkup(effect.formula, node.id);
    return '<div class="effect-card" data-effect-card="' + escapeAttr(effect.id) + '">'
      + '<div class="effect-top">'
      + '<select class="select" data-effect-id="' + escapeAttr(effect.id) + '" data-effect-field="paramName" title="Параметр сущности">'
      + effectParamOptions(page, effect.paramName) + '</select>'
      + '<button class="icon-remove" type="button" data-action="remove-effect" data-effect-id="' + escapeAttr(effect.id) + '" title="Удалить эффект">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
      + '</button>'
      + '</div>'
      + '<div class="effect-body">'
      + '<div class="effect-grid">'
      + '<select class="select" data-effect-id="' + escapeAttr(effect.id) + '" data-effect-field="op" title="Операция">'
      + operationOptions(effect.op) + '</select>'
      + '<input class="' + field.className + '" data-effect-id="' + escapeAttr(effect.id) + '" data-effect-field="formula" value="' + escapeAttr(effect.formula) + '" spellcheck="false" title="Формула изменения">'
      + '<div class="chance-wrap"><input class="input" type="number" min="0" max="100" step="1" data-effect-id="' + escapeAttr(effect.id) + '" data-effect-field="chance" value="' + escapeAttr(effect.chance) + '" title="Шанс, %"></div>'
      + '</div>'
      + '<div class="formula-meta"><span class="formula-error" data-formula-error>' + field.error + '</span>'
      + '<span class="formula-preview" data-formula-preview>' + field.preview + '</span></div>'
      + '</div>'
      + '</div>';
  }

  function renderInfluenceRow(node, linkId, influence) {
    const field = formulaFieldMarkup(influence.formula, node.id);
    return '<div class="influence-item" data-influence-card="' + escapeAttr(influence.id) + '">'
      + '<div class="influence-row">'
      + '<input class="input" data-link-id="' + escapeAttr(linkId) + '" data-influence-id="' + escapeAttr(influence.id) + '" data-influence-field="name" value="' + escapeAttr(influence.name) + '" title="Название влияния">'
      + '<input class="' + field.className + '" data-link-id="' + escapeAttr(linkId) + '" data-influence-id="' + escapeAttr(influence.id) + '" data-influence-field="formula" value="' + escapeAttr(influence.formula) + '" spellcheck="false" title="Величина влияния">'
      + '<div class="chance-wrap"><input class="input" type="number" min="0" max="100" step="1" data-link-id="' + escapeAttr(linkId) + '" data-influence-id="' + escapeAttr(influence.id) + '" data-influence-field="chance" value="' + escapeAttr(influence.chance) + '" title="Шанс, %"></div>'
      + '<button class="icon-remove" type="button" data-action="remove-influence" data-link-id="' + escapeAttr(linkId) + '" data-influence-id="' + escapeAttr(influence.id) + '" title="Удалить влияние">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
      + '</button>'
      + '</div>'
      + '<div class="formula-meta"><span class="formula-error" data-formula-error>' + field.error + '</span>'
      + '<span class="formula-preview" data-formula-preview>' + field.preview + '</span></div>'
      + '</div>';
  }

  function renderLinkCard(page, node, link) {
    const usedTargets = new Set(node.links.filter(function (item) {
      return item.id !== link.id;
    }).map(function (item) { return item.targetId; }));

    const targetOptions = page.nodes.filter(function (candidate) {
      return candidate.id !== node.id;
    }).map(function (candidate) {
      return '<option value="' + escapeAttr(candidate.id) + '"'
        + (candidate.id === link.targetId ? ' selected' : '')
        + (usedTargets.has(candidate.id) ? ' disabled' : '') + '>'
        + escapeHtml(displayName(candidate.name, 'Нода')) + '</option>';
    }).join('');

    const influences = link.influences.length
      ? link.influences.map(function (influence) {
        return renderInfluenceRow(node, link.id, influence);
      }).join('')
      : '<div class="empty-inline">Нет влияний. Связь работает только как переход.</div>';

    return '<div class="link-card" data-link-card="' + escapeAttr(link.id) + '">'
      + '<div class="link-target-row">'
      + '<select class="select" data-link-id="' + escapeAttr(link.id) + '" data-link-target title="Куда ведёт связь">'
      + targetOptions + '</select>'
      + '<button class="icon-remove" type="button" data-action="remove-link" data-link-id="' + escapeAttr(link.id) + '" title="Удалить связь">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
      + '</button>'
      + '</div>'
      + '<div class="link-body">'
      + '<div class="influence-list">' + influences + '</div>'
      + '<button class="btn-add-row" type="button" data-action="add-influence" data-link-id="' + escapeAttr(link.id) + '">+ Влияние</button>'
      + '</div>'
      + '</div>';
  }

  function renderNodeInspector(page, node) {
    if (!node) return '';
    const names = Store.paramNames(page);
    const incoming = Store.incomingSources(page, node.id);
    const influenceData = getInfluenceData(node.id);
    const conditionSummary = Engine.describeConditions(node.conditions);

    const variableChips = names.length
      ? '<div class="variable-chips">' + names.map(function (name) {
        return '<button class="var-chip" type="button" data-action="insert-variable" data-var="' + escapeAttr(name) + '">'
          + '{' + escapeHtml(name) + '}</button>';
      }).join('') + '</div>'
      : '<div class="field-hint">Добавьте параметры сущности, чтобы использовать переменные в формулах.</div>';

    const effectContent = names.length
      ? (node.effects.length
        ? node.effects.map(function (effect) { return renderEffectCard(page, node, effect); }).join('')
        : '<div class="empty-inline">Эффектов пока нет. Добавьте изменение параметра за цикл.</div>')
      : '<div class="empty-inline">У сущностей нет параметров. Создайте их в инспекторе сущности.</div>';

    const sourceMarkup = incoming.length
      ? '<div class="checkbox-grid">' + incoming.map(function (source) {
        return '<label class="checkbox-line"><input type="checkbox" data-cond-source value="' + escapeAttr(source.id) + '"'
          + (node.conditions.sources.includes(source.id) ? ' checked' : '') + '><span>'
          + escapeHtml(displayName(source.name, 'Нода')) + '</span></label>';
      }).join('') + '</div>'
      : '<div class="empty-inline">У ноды нет входящих связей.</div>';

    const linksContent = page.nodes.length > 1
      ? (node.links.length
        ? node.links.map(function (link) { return renderLinkCard(page, node, link); }).join('')
        : '<div class="empty-inline">Связей пока нет. Добавьте переход к другой ноде.</div>')
      : '<div class="empty-inline">Для связи нужна ещё хотя бы одна нода.</div>';

    const liveSources = Object.keys(influenceData.bySource || {}).map(function (sourceId) {
      const source = getNode(page, sourceId);
      const sourceInfluence = influenceData.bySource[sourceId];
      if (!source || !sourceInfluence || Math.abs(sourceInfluence.total) < EPSILON) return '';
      return '<div class="live-source-row"><span>' + escapeHtml(displayName(source.name, 'Нода'))
        + '</span><b>' + format(sourceInfluence.total, 2) + '</b></div>';
    }).filter(Boolean).join('');

    return inspectorHead('Нода', node.name,
      (node.conditions.enabled ? escapeHtml(conditionSummary) : 'без условий') + ' · ' + node.links.length + ' связей',
      '<button class="icon-remove" type="button" data-action="delete-node" title="Удалить ноду">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>')
      + '<div class="inspector-body">'
      + '<section class="inspector-section">'
      + '<div class="name-color-row">'
      + '<div class="field"><label>Имя ноды</label><input class="input" data-node-name value="' + escapeAttr(node.name) + '" placeholder="Бой"></div>'
      + '<div class="field"><label>Цвет</label><input class="input color-input" type="color" data-node-color value="' + escapeAttr(node.color) + '"></div>'
      + '</div>'
      + '<div class="field"><label>Описание</label><textarea class="textarea" data-node-desc rows="2" placeholder="Что происходит на этом этапе?">' + escapeHtml(node.description) + '</textarea></div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Условия срабатывания</h3>'
      + '<label class="switch" title="Включить логические условия"><input type="checkbox" data-cond-enabled'
      + (node.conditions.enabled ? ' checked' : '') + '><i></i></label></div>'
      + '<div class="conditions-body' + (node.conditions.enabled ? '' : ' is-hidden') + '">'
      + '<div class="field-row">'
      + '<div class="field"><label>Мин. влияние</label><input class="input" type="number" step="any" data-cond-min value="' + escapeAttr(node.conditions.min) + '" placeholder="—"></div>'
      + '<div class="field"><label>Макс. влияние</label><input class="input" type="number" step="any" data-cond-max value="' + escapeAttr(node.conditions.max) + '" placeholder="—"></div>'
      + '</div>'
      + '<div class="field"><label>Кратно числу</label><input class="input" type="number" step="any" min="0" data-cond-multiple value="' + escapeAttr(node.conditions.multiple) + '" placeholder="например, 2"></div>'
      + '<div class="field"><label>Влияние всех источников</label>' + sourceMarkup
      + '<div class="field-hint">Изменения сработают, только если каждый отмеченный источник передал ненулевое влияние.</div></div>'
      + '<label class="checkbox-line"><input type="checkbox" data-cond-all-chances'
      + (node.conditions.allChances ? ' checked' : '') + '><span>Только если сработали <b>все</b> шансы параметров и влияний</span></label>'
      + '<div class="field-hint">Проверка влияния выполняется перед применением эффектов ноды.</div>'
      + '</div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Изменения параметров</h3>'
      + '<button class="mini-add" type="button" data-action="add-effect" title="Добавить эффект">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      + '</button></div>'
      + effectContent
      + '<div style="margin-top:9px"><div class="field-label" style="margin-bottom:4px">Вставить переменную</div>' + variableChips + '</div>'
      + '<div class="field-hint" style="margin-top:8px">Формулы: <code>+5</code>, <code>{gold} * 0.1</code>, <code>max(1, floor({hp}/10))</code>. Доступны min, max, floor, ceil, round, abs, clamp, random.</div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Исходящие связи</h3>'
      + '<button class="mini-add" type="button" data-action="add-link" title="Добавить связь">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      + '</button></div>'
      + linksContent
      + '<div class="field-hint" style="margin-top:8px">Если у ноды несколько связей, сущность выбирает следующую ноду случайно. Влияния передаются в целевую ноду.</div>'
      + '</section>'
      + '<section class="inspector-section">'
      + '<div class="section-title-row"><h3>Влияние сейчас</h3></div>'
      + '<div class="live-card">'
      + '<div class="live-total"><b data-live-influence-total>' + format(influenceData.total, 2) + '</b><span>накоплено</span></div>'
      + '<div class="live-sources" data-live-sources>'
      + (liveSources || '<div class="live-source-empty">' + (sim ? 'Влияний пока нет.' : 'Запустите симуляцию, чтобы видеть входящие влияния.') + '</div>')
      + '</div></div>'
      + '</section>'
      + '<section class="danger-zone">'
      + '<button class="danger-btn" type="button" data-action="delete-node">Удалить ноду</button>'
      + '</section>'
      + '</div>';
  }

  function updateInspectorLive() {
    const page = getPage();
    if (!page) return;

    if (selection.type === 'node') {
      const node = getNode(page, selection.id);
      if (!node) return;
      const data = getInfluenceData(node.id);
      const total = dom.inspector.querySelector('[data-live-influence-total]');
      if (total) total.textContent = format(data.total, 2);
      const container = dom.inspector.querySelector('[data-live-sources]');
      if (container) {
        const rows = Object.keys(data.bySource || {}).map(function (sourceId) {
          const source = getNode(page, sourceId);
          const sourceData = data.bySource[sourceId];
          if (!source || !sourceData || Math.abs(sourceData.total) < EPSILON) return '';
          return '<div class="live-source-row"><span>' + escapeHtml(displayName(source.name, 'Нода'))
            + '</span><b>' + format(sourceData.total, 2) + '</b></div>';
        }).filter(Boolean);
        container.innerHTML = rows.length
          ? rows.join('')
          : '<div class="live-source-empty">' + (sim ? 'Влияний пока нет.' : 'Запустите симуляцию, чтобы видеть входящие влияния.') + '</div>';
      }
    }

    if (selection.type === 'entity') {
      const entity = getEntity(page, selection.id);
      const runtime = entity ? getSimEntity(entity.id) : null;
      if (!entity || !runtime) return;
      const currentNode = getNode(page, runtime.currentId);
      const nodeField = dom.inspector.querySelector('[data-live-entity-node]');
      if (nodeField) nodeField.textContent = currentNode ? displayName(currentNode.name, 'Нода') : '—';
      entity.params.forEach(function (param) {
        const field = Array.from(dom.inspector.querySelectorAll('[data-live-param]')).find(function (element) {
          return element.dataset.liveParam === param.id;
        });
        if (field) {
          const value = Object.prototype.hasOwnProperty.call(runtime.params, param.id) ? runtime.params[param.id] : param.value;
          field.textContent = format(value, 3);
        }
      });
    }
  }

  function renderEventLog() {
    dom.eventLog.innerHTML = '';
    if (!eventLog.length) {
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = 'Запустите симуляцию, чтобы увидеть, как сущности проходят по нодам.';
      dom.eventLog.appendChild(empty);
    } else {
      const fragment = document.createDocumentFragment();
      eventLog.forEach(function (event) {
        fragment.appendChild(createLogEntry(event));
      });
      dom.eventLog.appendChild(fragment);
      dom.eventLog.scrollTop = dom.eventLog.scrollHeight;
    }
    updateEventCount();
  }

  function createLogEntry(event) {
    const entry = document.createElement('div');
    entry.className = 'log-entry tone-' + (event.tone || 'muted');
    const tick = document.createElement('span');
    tick.className = 'log-tick';
    tick.textContent = event.tick ? '#' + event.tick : 'sys';
    const mark = document.createElement('span');
    mark.className = 'log-mark';
    const text = document.createElement('span');
    text.className = 'log-text';
    text.textContent = event.text;
    text.title = event.text;
    entry.appendChild(tick);
    entry.appendChild(mark);
    entry.appendChild(text);
    return entry;
  }

  function appendLogEvents(events) {
    if (!events || !events.length) return;
    const empty = dom.eventLog.querySelector('.log-empty');
    if (empty) empty.remove();

    const atBottom = dom.eventLog.scrollHeight - dom.eventLog.scrollTop - dom.eventLog.clientHeight < 36;
    const fragment = document.createDocumentFragment();
    events.forEach(function (event) {
      eventLog.push(event);
      fragment.appendChild(createLogEntry(event));
    });
    dom.eventLog.appendChild(fragment);

    while (eventLog.length > MAX_LOG) {
      eventLog.shift();
      if (dom.eventLog.firstElementChild) dom.eventLog.removeChild(dom.eventLog.firstElementChild);
    }

    if (atBottom || simulationRunning) {
      dom.eventLog.scrollTop = dom.eventLog.scrollHeight;
    }
    updateEventCount();
  }

  function updateEventCount() {
    const count = eventLog.length;
    const label = count % 10 === 1 && count % 100 !== 11
      ? 'событие'
      : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)
        ? 'события'
        : 'событий';
    dom.eventCount.textContent = count + ' ' + label;
  }

  function clearEventLog() {
    eventLog = [];
    renderEventLog();
  }

  function updateFormulaFeedback(input, formula, nodeId) {
    const info = formulaState(formula, nodeId);
    input.classList.toggle('is-invalid', !info.ok);
    const card = input.closest('.effect-card, .influence-item');
    const meta = card ? card.querySelector('.formula-meta') : null;
    if (meta) {
      const error = meta.querySelector('[data-formula-error]');
      const preview = meta.querySelector('[data-formula-preview]');
      if (error) error.textContent = info.error;
      if (preview) preview.textContent = info.preview;
    }
  }

  function updateEntityNameUI(entity) {
    renderLists();
    const token = findEntityElement(entity.id);
    if (token) {
      token.title = displayName(entity.name, 'Сущность');
      const tooltip = token.querySelector('.entity-tooltip');
      if (tooltip) tooltip.textContent = displayName(entity.name, 'Сущность');
    }
    const title = dom.inspector.querySelector('[data-inspector-title]');
    if (title) title.textContent = displayName(entity.name, 'Сущность');
  }

  function updateNodeNameUI(node) {
    renderLists();
    const card = findNodeElement(node.id);
    if (card) {
      const title = card.querySelector('.node-title');
      if (title) title.textContent = displayName(node.name, 'Нода');
      card.setAttribute('aria-label', 'Нода ' + displayName(node.name, 'Нода'));
    }
    const title = dom.inspector.querySelector('[data-inspector-title]');
    if (title) title.textContent = displayName(node.name, 'Нода');
    renderEdges();
  }

  function updatePageNameUI(page) {
    if (!dom.inspector.querySelector('[data-page-name]')) return;
    const title = dom.inspector.querySelector('[data-inspector-title]');
    if (title) title.textContent = displayName(page.name, 'Без названия');
  }

  function onInspectorInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName === 'SELECT') return;

    const page = getPage();
    if (!page) return;

    if (target.matches('[data-page-name]')) {
      page.name = target.value;
      renderPageSelect();
      updatePageNameUI(page);
      persistSoon();
      return;
    }

    const entity = getSelectedEntity();
    if (entity && target.matches('[data-entity-name]')) {
      entity.name = target.value;
      updateEntityNameUI(entity);
      persistSoon();
      return;
    }

    if (entity && target.matches('[data-entity-color]')) {
      entity.color = target.value;
      const token = findEntityElement(entity.id);
      if (token) token.style.setProperty('--entity-color', entity.color);
      renderLists();
      persistSoon();
      return;
    }

    if (entity && target.matches('[data-param-value]')) {
      const param = entity.params.find(function (item) { return item.id === target.dataset.paramId; });
      if (!param) return;
      param.value = target.value === '' ? 0 : (Number.isFinite(Number(target.value)) ? Number(target.value) : 0);
      if (sim && sim.tick === 0) {
        const runtime = getSimEntity(entity.id);
        if (runtime) runtime.params[param.id] = param.value;
      }
      persistSoon();
      return;
    }

    const node = getSelectedNode();
    if (node && target.matches('[data-node-name]')) {
      node.name = target.value;
      updateNodeNameUI(node);
      persistSoon();
      return;
    }

    if (node && target.matches('[data-node-desc]')) {
      node.description = target.value;
      const card = findNodeElement(node.id);
      if (card) {
        const desc = card.querySelector('.node-desc');
        if (desc) {
          desc.textContent = node.description || 'без описания';
          desc.classList.toggle('is-empty', !node.description);
          if (node.description) desc.title = node.description;
          else desc.removeAttribute('title');
        }
      }
      persistSoon();
      return;
    }

    if (node && target.matches('[data-node-color]')) {
      node.color = target.value;
      const card = findNodeElement(node.id);
      if (card) card.style.setProperty('--node-color', node.color);
      renderLists();
      persistSoon();
      return;
    }

    if (node && target.matches('[data-cond-min], [data-cond-max], [data-cond-multiple]')) {
      if (target.matches('[data-cond-min]')) node.conditions.min = target.value;
      if (target.matches('[data-cond-max]')) node.conditions.max = target.value;
      if (target.matches('[data-cond-multiple]')) node.conditions.multiple = target.value;
      persistSoon();
      return;
    }

    if (node && target.matches('[data-effect-field]')) {
      const effect = node.effects.find(function (item) { return item.id === target.dataset.effectId; });
      if (!effect) return;
      if (target.dataset.effectField === 'formula') {
        effect.formula = target.value;
        updateFormulaFeedback(target, effect.formula, node.id);
      } else if (target.dataset.effectField === 'chance') {
        if (target.value === '') return;
        effect.chance = clamp(Number(target.value) || 0, 0, 100);
      }
      persistSoon();
      return;
    }

    if (node && target.matches('[data-influence-field]')) {
      const link = node.links.find(function (item) { return item.id === target.dataset.linkId; });
      const influence = link ? link.influences.find(function (item) { return item.id === target.dataset.influenceId; }) : null;
      if (!influence) return;
      if (target.dataset.influenceField === 'name') {
        influence.name = target.value;
        renderEdges();
      } else if (target.dataset.influenceField === 'formula') {
        influence.formula = target.value;
        updateFormulaFeedback(target, influence.formula, node.id);
      } else if (target.dataset.influenceField === 'chance') {
        if (target.value === '') return;
        influence.chance = clamp(Number(target.value) || 0, 0, 100);
      }
      persistSoon();
    }
  }

  function renameParam(entity, param, value) {
    const page = getPage();
    if (!page) return false;
    const next = value.trim();
    if (!next) {
      toast('Имя параметра не может быть пустым', 'warn');
      return false;
    }
    if (/[{}]/.test(next)) {
      toast('В имени параметра нельзя использовать фигурные скобки', 'warn');
      return false;
    }
    if (entity.params.some(function (item) { return item.id !== param.id && item.name.toLowerCase() === next.toLowerCase(); })) {
      toast('Параметр с таким именем уже есть у сущности', 'warn');
      return false;
    }
    if (next === param.name) return true;

    const oldName = param.name;
    param.name = next;

    if (!Store.hasParamName(page, oldName)) {
      page.nodes.forEach(function (node) {
        node.effects.forEach(function (effect) {
          if (effect.paramName === oldName) effect.paramName = next;
        });
      });
    }

    let formulaReferences = false;
    page.nodes.forEach(function (node) {
      node.effects.forEach(function (effect) {
        if (effect.formula.includes('{' + oldName + '}')) formulaReferences = true;
      });
      node.links.forEach(function (link) {
        link.influences.forEach(function (influence) {
          if (influence.formula.includes('{' + oldName + '}')) formulaReferences = true;
        });
      });
    });

    if (formulaReferences) {
      toast('Параметр переименован. Проверьте формулы со старым именем {' + oldName + '}.', 'warn', 6000);
    }
    return true;
  }

  function onInspectorChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const page = getPage();
    if (!page) return;

    if (target.matches('[data-page-name]')) {
      if (!target.value.trim()) {
        page.name = 'Новая схема';
        target.value = page.name;
      }
      renderPageSelect();
      updatePageNameUI(page);
      persistSoon();
      return;
    }

    const entity = getSelectedEntity();
    if (entity && target.matches('[data-entity-name]')) {
      if (!target.value.trim()) {
        entity.name = 'Сущность';
        target.value = entity.name;
      }
      updateEntityNameUI(entity);
      persistSoon();
      return;
    }

    if (entity && target.matches('[data-param-name]')) {
      const param = entity.params.find(function (item) { return item.id === target.dataset.paramId; });
      if (!param) return;
      if (!renameParam(entity, param, target.value)) {
        target.value = param.name;
        return;
      }
      persistSoon();
      refreshGraphAndLists();
      rerenderInspectorPreserveScroll();
      return;
    }

    if (entity && target.matches('[data-entity-start]')) {
      entity.startNodeId = target.value || null;
      if (sim && sim.tick === 0) {
        const runtime = getSimEntity(entity.id);
        if (runtime) runtime.currentId = entity.startNodeId || (page.nodes[0] ? page.nodes[0].id : null);
      }
      renderLists();
      updateEntityPositions();
      persistSoon();
      return;
    }

    const node = getSelectedNode();
    if (node && target.matches('[data-node-name]')) {
      if (!target.value.trim()) {
        node.name = 'Нода';
        target.value = node.name;
      }
      updateNodeNameUI(node);
      persistSoon();
      return;
    }

    if (node && target.matches('[data-cond-enabled]')) {
      node.conditions.enabled = target.checked;
      renderGraph();
      renderLists();
      rerenderInspectorPreserveScroll();
      persistSoon();
      return;
    }

    if (node && target.matches('[data-cond-source]')) {
      const sourceId = target.value;
      if (target.checked) {
        if (!node.conditions.sources.includes(sourceId)) node.conditions.sources.push(sourceId);
      } else {
        node.conditions.sources = node.conditions.sources.filter(function (id) { return id !== sourceId; });
      }
      persistSoon();
      return;
    }

    if (node && target.matches('[data-cond-all-chances]')) {
      node.conditions.allChances = target.checked;
      persistSoon();
      return;
    }

    if (node && target.matches('[data-effect-field]')) {
      const effect = node.effects.find(function (item) { return item.id === target.dataset.effectId; });
      if (!effect) return;
      if (target.dataset.effectField === 'paramName') effect.paramName = target.value;
      if (target.dataset.effectField === 'op') effect.op = target.value;
      if (target.dataset.effectField === 'chance') {
        effect.chance = clamp(Number(target.value) || 0, 0, 100);
        target.value = effect.chance;
      }
      persistSoon();
      return;
    }

    if (node && target.matches('[data-link-target]')) {
      const link = node.links.find(function (item) { return item.id === target.dataset.linkId; });
      if (!link) return;
      const duplicate = node.links.some(function (item) {
        return item.id !== link.id && item.targetId === target.value;
      });
      if (duplicate) {
        toast('Связь к этой ноде уже существует', 'warn');
        target.value = link.targetId;
        return;
      }
      if (target.value === node.id || !getNode(page, target.value)) {
        target.value = link.targetId;
        return;
      }
      link.targetId = target.value;
      pruneConditionSources(page);
      renderEdges();
      rerenderInspectorPreserveScroll();
      persistSoon();
      return;
    }

    if (node && target.matches('[data-influence-field]')) {
      const link = node.links.find(function (item) { return item.id === target.dataset.linkId; });
      const influence = link ? link.influences.find(function (item) { return item.id === target.dataset.influenceId; }) : null;
      if (!influence) return;
      if (target.dataset.influenceField === 'chance') {
        influence.chance = clamp(Number(target.value) || 0, 0, 100);
        target.value = influence.chance;
      }
      persistSoon();
      return;
    }

    if (target.matches('[data-effect-field="chance"]')) {
      const effect = node ? node.effects.find(function (item) { return item.id === target.dataset.effectId; }) : null;
      if (effect) {
        effect.chance = clamp(Number(target.value) || 0, 0, 100);
        target.value = effect.chance;
      }
    }
  }

  function pruneConditionSources(page) {
    page.nodes.forEach(function (node) {
      node.conditions.sources = node.conditions.sources.filter(function (sourceId) {
        return page.nodes.some(function (candidate) {
          return candidate.id === sourceId && candidate.links.some(function (link) {
            return link.targetId === node.id;
          });
        });
      });
    });
  }

  function addEntity() {
    const page = getPage();
    if (!page) return;
    const name = Store.nextName('Сущность ' + (page.entities.length + 1), page.entities.map(function (entity) { return entity.name; }));
    const color = Store.ENTITY_COLORS[page.entities.length % Store.ENTITY_COLORS.length];
    const entity = Store.createEntity(name, page.nodes.length ? page.nodes[0].id : null, color);
    page.entities.push(entity);
    Engine.syncSimulation(page, sim);
    selection = { type: 'entity', id: entity.id };
    renderGraph();
    renderLists();
    renderInspector();
    updateControls();
    persistSoon();
    toast('Сущность добавлена. Настройте её параметры.', 'success');
  }

  function addNode() {
    const page = getPage();
    if (!page) return;
    const rect = dom.graph.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const wasEmpty = page.nodes.length === 0;
    const name = Store.nextName('Нода ' + (page.nodes.length + 1), page.nodes.map(function (node) { return node.name; }));
    const color = Store.NODE_COLORS[page.nodes.length % Store.NODE_COLORS.length];
    const node = Store.createNode(
      name,
      Math.round(center.x - NODE_W / 2 + (page.nodes.length % 3 - 1) * 34),
      Math.round(center.y - NODE_H / 2 + (page.nodes.length % 2) * 26),
      color
    );
    page.nodes.push(node);
    page.entities.forEach(function (entity) {
      if (!entity.startNodeId) entity.startNodeId = node.id;
    });
    Engine.syncSimulation(page, sim);
    selection = { type: 'node', id: node.id };
    renderGraph();
    renderLists();
    renderInspector();
    updateControls();
    if (wasEmpty) {
      requestAnimationFrame(fitGraph);
    }
    persistSoon();
    toast('Нода добавлена. Настройте эффекты и связи.', 'success');
  }

  function addParam() {
    const entity = getSelectedEntity();
    if (!entity) return;
    const name = Store.nextName('параметр', entity.params.map(function (param) { return param.name; }));
    const param = Store.createParam(name, 0);
    entity.params.push(param);
    Engine.syncSimulation(getPage(), sim);
    renderGraph();
    renderLists();
    renderInspector();
    const input = Array.from(dom.inspector.querySelectorAll('[data-param-name]')).find(function (element) {
      return element.dataset.paramId === param.id;
    });
    if (input) {
      input.focus();
      input.select();
    }
    persistSoon();
  }

  function removeParam(paramId) {
    const page = getPage();
    const entity = getSelectedEntity();
    if (!page || !entity) return;
    const param = entity.params.find(function (item) { return item.id === paramId; });
    if (!param) return;
    entity.params = entity.params.filter(function (item) { return item.id !== paramId; });

    if (!Store.hasParamName(page, param.name)) {
      page.nodes.forEach(function (node) {
        node.effects = node.effects.filter(function (effect) { return effect.paramName !== param.name; });
      });
    }
    Engine.syncSimulation(page, sim);
    renderGraph();
    renderLists();
    renderInspector();
    persistSoon();
    toast('Параметр удалён', 'info');
  }

  function addEffect() {
    const page = getPage();
    const node = getSelectedNode();
    if (!page || !node) return;
    const names = Store.paramNames(page);
    if (!names.length) {
      toast('Сначала добавьте параметр сущности', 'warn');
      return;
    }
    node.effects.push(Store.createEffect(names[0], '1', 100, 'add'));
    refreshGraphAndLists();
    rerenderInspectorPreserveScroll();
    persistSoon();
  }

  function removeEffect(effectId) {
    const node = getSelectedNode();
    if (!node) return;
    node.effects = node.effects.filter(function (effect) { return effect.id !== effectId; });
    refreshGraphAndLists();
    rerenderInspectorPreserveScroll();
    persistSoon();
  }

  function addLink() {
    const page = getPage();
    const node = getSelectedNode();
    if (!page || !node) return;
    const used = new Set(node.links.map(function (link) { return link.targetId; }));
    const target = page.nodes.find(function (candidate) {
      return candidate.id !== node.id && !used.has(candidate.id);
    });
    if (!target) {
      toast('Нет доступной ноды для новой связи', 'warn');
      return;
    }
    node.links.push(Store.createLink(target.id, [Store.createInfluence('влияние', '1', 100)]));
    refreshGraphAndLists();
    rerenderInspectorPreserveScroll();
    persistSoon();
  }

  function removeLink(linkId) {
    const page = getPage();
    const node = getSelectedNode();
    if (!page || !node) return;
    node.links = node.links.filter(function (link) { return link.id !== linkId; });
    pruneConditionSources(page);
    refreshGraphAndLists();
    rerenderInspectorPreserveScroll();
    persistSoon();
  }

  function addInfluence(linkId) {
    const node = getSelectedNode();
    if (!node) return;
    const link = node.links.find(function (item) { return item.id === linkId; });
    if (!link) return;
    link.influences.push(Store.createInfluence('влияние', '1', 100));
    rerenderInspectorPreserveScroll();
    persistSoon();
  }

  function removeInfluence(linkId, influenceId) {
    const node = getSelectedNode();
    if (!node) return;
    const link = node.links.find(function (item) { return item.id === linkId; });
    if (!link) return;
    link.influences = link.influences.filter(function (influence) { return influence.id !== influenceId; });
    renderEdges();
    rerenderInspectorPreserveScroll();
    persistSoon();
  }

  function deleteEntity() {
    const page = getPage();
    const entity = getSelectedEntity();
    if (!page || !entity) return;
    page.entities = page.entities.filter(function (item) { return item.id !== entity.id; });
    selection = { type: null, id: null };
    Engine.syncSimulation(page, sim);
    if (sim && !page.entities.length) stopSimulation(true);
    renderGraph();
    renderLists();
    renderInspector();
    updateControls();
    persistSoon();
    toast('Сущность удалена', 'info');
  }

  function deleteNode() {
    const page = getPage();
    const node = getSelectedNode();
    if (!page || !node) return;
    page.nodes = page.nodes.filter(function (item) { return item.id !== node.id; });

    page.nodes.forEach(function (candidate) {
      candidate.links = candidate.links.filter(function (link) { return link.targetId !== node.id; });
      candidate.conditions.sources = candidate.conditions.sources.filter(function (id) { return id !== node.id; });
    });
    page.entities.forEach(function (entity) {
      if (entity.startNodeId === node.id) {
        entity.startNodeId = page.nodes.length ? page.nodes[0].id : null;
      }
    });
    pruneConditionSources(page);

    selection = { type: null, id: null };
    Engine.syncSimulation(page, sim);
    if (sim && !page.nodes.length) stopSimulation(true);
    renderGraph();
    renderLists();
    renderInspector();
    updateControls();
    persistSoon();
    toast('Нода удалена', 'info');
  }

  function insertVariable(name) {
    let input = lastFormulaInput;
    if (!input || !input.isConnected) {
      input = dom.inspector.querySelector('.formula-input');
    }
    if (!input) {
      toast('Сначала добавьте эффект или влияние с формулой', 'info');
      return;
    }
    const token = '{' + name + '}';
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + token.length;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function handleAction(action, element) {
    switch (action) {
      case 'add-entity':
      case 'empty-add-entity':
        addEntity();
        break;
      case 'add-node':
      case 'empty-add-node':
        addNode();
        break;
      case 'add-param':
        addParam();
        break;
      case 'remove-param':
        removeParam(element.dataset.paramId);
        break;
      case 'add-effect':
        addEffect();
        break;
      case 'remove-effect':
        removeEffect(element.dataset.effectId);
        break;
      case 'add-link':
        addLink();
        break;
      case 'remove-link':
        removeLink(element.dataset.linkId);
        break;
      case 'add-influence':
        addInfluence(element.dataset.linkId);
        break;
      case 'remove-influence':
        removeInfluence(element.dataset.linkId, element.dataset.influenceId);
        break;
      case 'delete-entity':
        deleteEntity();
        break;
      case 'delete-node':
        deleteNode();
        break;
      case 'insert-variable':
        insertVariable(element.dataset.var);
        break;
      case 'help':
        openHelp();
        break;
      default:
        break;
    }
  }

  function ensureSimulation() {
    const page = getPage();
    if (!page) return null;
    if (!sim) {
      sim = Engine.createSimulation(page);
      renderGraph();
    } else {
      Engine.syncSimulation(page, sim);
    }
    return sim;
  }

  function validateSimulationReady() {
    const page = getPage();
    if (!page) return false;
    if (!page.nodes.length) {
      toast('Сначала добавьте хотя бы одну ноду', 'warn');
      return false;
    }
    if (!page.entities.length) {
      toast('Добавьте сущность, чтобы запустить симуляцию', 'warn');
      return false;
    }
    return true;
  }

  function startSimulation() {
    if (simulationRunning) return;
    if (!validateSimulationReady()) return;
    ensureSimulation();
    if (!sim) return;
    simulationRunning = true;
    updateControls();
    pushSystemEvent('Симуляция запущена · скорость ' + String(state.speed).replace('.', ',') + '×', 'info');
    scheduleNextTick(180);
  }

  function pauseSimulation(silent) {
    if (!simulationRunning) return;
    simulationRunning = false;
    clearTimeout(runTimer);
    runTimer = null;
    updateControls();
    if (!silent) pushSystemEvent('Пауза', 'muted');
  }

  function toggleSimulation() {
    if (simulationRunning) pauseSimulation(false);
    else startSimulation();
  }

  function scheduleNextTick(delay) {
    if (!simulationRunning) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(function () {
      runTimer = null;
      if (!simulationRunning) return;
      performTick();
      if (simulationRunning) scheduleNextTick(TICK_MS / state.speed);
    }, Math.max(60, delay == null ? TICK_MS / state.speed : delay));
  }

  function performTick() {
    const page = getPage();
    if (!page || !sim) return;
    if (!page.nodes.length || !page.entities.length) {
      pauseSimulation(true);
      updateControls();
      return;
    }

    try {
      const result = Engine.step(page, sim);
      appendLogEvents(result.events);
      animateSimulationResult(result);
      updateGraphRuntime();
      updateInspectorLive();
      updateControls();
    } catch (error) {
      console.error('LoopLab: ошибка симуляции', error);
      pauseSimulation(true);
      pushSystemEvent('Ошибка симуляции: ' + error.message, 'bad');
      toast('Симуляция остановлена из-за ошибки: ' + error.message, 'error', 7000);
    }
  }

  function stepSimulation() {
    if (!validateSimulationReady()) return;
    if (simulationRunning) pauseSimulation(true);
    ensureSimulation();
    performTick();
    updateControls();
  }

  function resetSimulation() {
    const page = getPage();
    if (!page) return;
    simulationRunning = false;
    clearTimeout(runTimer);
    runTimer = null;
    sim = Engine.createSimulation(page);
    clearEventLog();
    renderGraph();
    renderInspector();
    updateControls();
    pushSystemEvent('Симуляция сброшена к стартовым значениям', 'muted');
    requestAnimationFrame(fitGraph);
  }

  function clearInfluences() {
    if (!sim) {
      toast('Сначала запустите симуляцию', 'info');
      return;
    }
    Engine.clearInfluences(sim);
    updateGraphRuntime();
    updateInspectorLive();
    toast('Накопленное влияние сброшено', 'success');
    pushSystemEvent('Все накопленные влияния обнулены', 'muted');
  }

  function switchPage(pageId) {
    if (!state.pages.some(function (page) { return page.id === pageId; })) return;
    if (state.activePageId === pageId) return;
    simulationRunning = false;
    clearTimeout(runTimer);
    runTimer = null;
    sim = null;
    selection = { type: null, id: null };
    eventLog = [];
    state.activePageId = pageId;
    renderPageSelect();
    renderEventLog();
    renderLists();
    renderGraph();
    renderInspector();
    updateControls();
    persistSoon();
    requestAnimationFrame(fitGraph);
  }

  function addPage() {
    const name = Store.nextName('Схема ' + (state.pages.length + 1), state.pages.map(function (page) { return page.name; }));
    const page = Store.createEmptyPage(name);
    state.pages.push(page);
    simulationRunning = false;
    clearTimeout(runTimer);
    runTimer = null;
    sim = null;
    selection = { type: null, id: null };
    eventLog = [];
    state.activePageId = page.id;
    renderPageSelect();
    renderEventLog();
    renderLists();
    renderGraph();
    renderInspector();
    updateControls();
    persistSoon();
    requestAnimationFrame(fitGraph);
    toast('Создана новая схема', 'success');
  }

  function deleteCurrentPage() {
    if (state.pages.length <= 1) {
      toast('Нельзя удалить единственную схему', 'warn');
      return;
    }
    const page = getPage();
    if (!page) return;

    showConfirm({
      title: 'Удалить схему?',
      message: 'Схема «' + displayName(page.name, 'Без названия') + '» и все её ноды, сущности и связи будут удалены. Это действие нельзя отменить.',
      confirmLabel: 'Удалить схему',
      danger: true,
      onConfirm: function () {
        const index = state.pages.findIndex(function (item) { return item.id === page.id; });
        state.pages = state.pages.filter(function (item) { return item.id !== page.id; });
        const next = state.pages[Math.max(0, index - 1)] || state.pages[0];
        simulationRunning = false;
        clearTimeout(runTimer);
        runTimer = null;
        sim = null;
        selection = { type: null, id: null };
        eventLog = [];
        state.activePageId = next.id;
        renderPageSelect();
        renderEventLog();
        renderLists();
        renderGraph();
        renderInspector();
        updateControls();
        persistSoon();
        requestAnimationFrame(fitGraph);
        toast('Схема удалена', 'info');
      }
    });
  }

  function clearCurrentPage() {
    const page = getPage();
    if (!page) return;
    if (!page.nodes.length && !page.entities.length) {
      toast('Схема уже пуста', 'info');
      return;
    }

    showConfirm({
      title: 'Очистить схему?',
      message: 'Все ноды, сущности и связи схемы «' + displayName(page.name, 'Без названия') + '» будут удалены. Название схемы сохранится.',
      confirmLabel: 'Очистить схему',
      danger: true,
      onConfirm: function () {
        page.nodes = [];
        page.entities = [];
        simulationRunning = false;
        clearTimeout(runTimer);
        runTimer = null;
        sim = null;
        selection = { type: null, id: null };
        eventLog = [];
        renderEventLog();
        renderLists();
        renderGraph();
        renderInspector();
        updateControls();
        persistSoon();
        requestAnimationFrame(fitGraph);
        toast('Схема очищена', 'info');
      }
    });
  }

  function exportSchemas() {
    try {
      const payload = Store.exportPayload(state.pages);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = 'looplab-schemas-' + date + '.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Экспортировано схем: ' + state.pages.length, 'success');
    } catch (error) {
      toast('Ошибка экспорта: ' + error.message, 'error', 6000);
    }
  }

  async function importSchemas(file) {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) {
        throw new Error('Файл слишком большой (максимум 8 МБ)');
      }
      const text = await file.text();
      const data = JSON.parse(text);
      const rawPages = Store.extractPagesFromJSON(data);
      if (!rawPages.length) {
        throw new Error('В JSON не найдено ни одной схемы');
      }

      const pages = rawPages.map(function (rawPage) {
        return Store.normalizePage(rawPage, { preserveIds: false });
      });
      const usedNames = new Set(state.pages.map(function (item) { return item.name; }));
      pages.forEach(function (page) {
        page.name = Store.uniquePageName(page.name, usedNames);
        usedNames.add(page.name);
      });

      stopSimulation(true);
      sim = null;
      state.pages.push.apply(state.pages, pages);
      state.activePageId = pages[0].id;
      selection = { type: null, id: null };
      eventLog = [];
      renderPageSelect();
      renderEventLog();
      renderLists();
      renderGraph();
      renderInspector();
      updateControls();
      persistSoon();
      requestAnimationFrame(fitGraph);
      toast('Импортировано схем: ' + pages.length, 'success', 5000);
    } catch (error) {
      toast('Не удалось импортировать: ' + error.message, 'error', 7000);
    } finally {
      dom.importFile.value = '';
    }
  }

  function showModal(options) {
    const opts = options || {};
    modalConfirmHandler = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
    const actions = [];
    if (!opts.hideCancel) {
      actions.push('<button class="secondary-btn" type="button" data-modal-cancel>'
        + escapeHtml(opts.cancelLabel || 'Отмена') + '</button>');
    }
    actions.push('<button class="' + (opts.danger ? 'danger-btn' : 'primary-btn') + '" type="button" data-modal-confirm>'
      + escapeHtml(opts.confirmLabel || 'Понятно') + '</button>');

    dom.modalRoot.innerHTML = '<div class="modal-backdrop" data-modal-backdrop>'
      + '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">'
      + '<div class="modal-head"><div><h2 id="modalTitle">' + escapeHtml(opts.title || '') + '</h2>'
      + (opts.subtitle ? '<p>' + escapeHtml(opts.subtitle) + '</p>' : '')
      + '</div><button class="modal-close" type="button" data-modal-close aria-label="Закрыть">'
      + '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
      + '</button></div>'
      + '<div class="modal-body">' + (opts.body || '') + '</div>'
      + '<div class="modal-actions">' + actions.join('') + '</div>'
      + '</div></div>';

    const backdrop = dom.modalRoot.querySelector('[data-modal-backdrop]');
    if (backdrop) {
      backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) closeModal();
      });
    }
    const close = dom.modalRoot.querySelector('[data-modal-close]');
    if (close) close.addEventListener('click', closeModal);
    const cancel = dom.modalRoot.querySelector('[data-modal-cancel]');
    if (cancel) cancel.addEventListener('click', closeModal);
    const confirm = dom.modalRoot.querySelector('[data-modal-confirm]');
    if (confirm) {
      confirm.addEventListener('click', function () {
        const handler = modalConfirmHandler;
        closeModal();
        if (handler) handler();
      });
      setTimeout(function () { confirm.focus(); }, 30);
    }
  }

  function closeModal() {
    modalConfirmHandler = null;
    dom.modalRoot.innerHTML = '';
  }

  function showConfirm(options) {
    showModal({
      title: options.title,
      subtitle: options.subtitle || '',
      body: '<p>' + escapeHtml(options.message || '') + '</p>',
      confirmLabel: options.confirmLabel || 'Подтвердить',
      cancelLabel: options.cancelLabel || 'Отмена',
      danger: Boolean(options.danger),
      onConfirm: options.onConfirm
    });
  }

  function openHelp() {
    showModal({
      title: 'Как работает LoopLab',
      subtitle: 'Краткая модель симуляции',
      hideCancel: true,
      confirmLabel: 'Понятно',
      body: '<p><b>Сущности</b> живут в графе и каждый цикл проходят одну ноду. Нода применяет эффекты к параметрам сущности, затем передаёт влияния по исходящим связям.</p>'
        + '<div class="modal-help-grid">'
        + '<div class="help-tile"><b>1 цикл</b><span>При скорости 1× длится 1 секунду. Все сущности обрабатываются заново.</span></div>'
        + '<div class="help-tile"><b>Переходы</b><span>Если у ноды несколько исходящих связей, следующая выбирается случайно.</span></div>'
        + '<div class="help-tile"><b>Влияние</b><span>Число накапливается в целевой ноде и проверяется её условиями.</span></div>'
        + '<div class="help-tile"><b>Шансы</b><span>Каждый эффект и влияние срабатывает независимо, если не включён режим «все шансы».</span></div>'
        + '</div>'
        + '<p><b>Формулы.</b> Параметры вставляются как <code>{hp}</code> или <code>{gold}</code>. Доступны операторы <code>+ − * / % ^</code> и функции <code>min</code>, <code>max</code>, <code>floor</code>, <code>ceil</code>, <code>round</code>, <code>abs</code>, <code>clamp</code>, <code>random</code>. Также можно использовать <code>cycle</code> и <code>influence</code>.</p>'
        + '<p><b>Условия ноды</b> проверяют суммарное влияние: минимум, максимум, кратность и наличие влияния от выбранных источников. Включённый режим «все шансы» блокирует все изменения, если хотя бы один бросок не прошёл.</p>'
        + '<p>Данные автоматически сохраняются в localStorage. Экспорт создаёт JSON со всеми схемами, импорт добавляет схемы из файла, не удаляя текущие.</p>'
    });
  }

  function toast(message, tone, duration) {
    const item = document.createElement('div');
    item.className = 'toast ' + (tone || 'success');
    const mark = document.createElement('span');
    mark.className = 'toast-mark';
    const text = document.createElement('span');
    text.textContent = message;
    item.appendChild(mark);
    item.appendChild(text);
    dom.toastRoot.appendChild(item);

    while (dom.toastRoot.children.length > 4) {
      dom.toastRoot.removeChild(dom.toastRoot.firstElementChild);
    }

    setTimeout(function () {
      item.classList.add('is-leaving');
      setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, 220);
    }, duration == null ? 4200 : duration);
  }

  function toggleConsole() {
    consoleCollapsed = !consoleCollapsed;
    dom.console.classList.toggle('is-collapsed', consoleCollapsed);
    dom.consoleToggleBtn.title = consoleCollapsed ? 'Развернуть журнал' : 'Свернуть журнал';
  }

  function renderApplication() {
    renderPageSelect();
    renderLists();
    renderGraph();
    renderInspector();
    updateControls();
  }

  function bindEvents() {
    dom.pageSelect.addEventListener('change', function () {
      switchPage(dom.pageSelect.value);
    });

    dom.addPageBtn.addEventListener('click', addPage);
    dom.deletePageBtn.addEventListener('click', deleteCurrentPage);
    dom.clearPageBtn.addEventListener('click', clearCurrentPage);
    dom.helpBtn.addEventListener('click', openHelp);
    dom.exportBtn.addEventListener('click', exportSchemas);
    dom.importBtn.addEventListener('click', function () { dom.importFile.click(); });
    dom.importFile.addEventListener('change', function () {
      const file = dom.importFile.files && dom.importFile.files[0];
      if (file) importSchemas(file);
    });

    dom.runBtn.addEventListener('click', toggleSimulation);
    dom.stepBtn.addEventListener('click', stepSimulation);
    dom.resetBtn.addEventListener('click', resetSimulation);
    dom.clearInfluenceBtn.addEventListener('click', clearInfluences);

    dom.addEntityBtn.addEventListener('click', addEntity);
    dom.addNodeBtn.addEventListener('click', addNode);

    dom.entityList.addEventListener('click', function (event) {
      const item = event.target.closest('[data-list-entity]');
      if (item) selectItem('entity', item.dataset.listEntity);
    });
    dom.nodeList.addEventListener('click', function (event) {
      const item = event.target.closest('[data-list-node]');
      if (item) selectItem('node', item.dataset.listNode);
    });

    dom.speedButtons.addEventListener('click', function (event) {
      const button = event.target.closest('[data-speed]');
      if (button) setSpeed(button.dataset.speed);
    });

    dom.graph.addEventListener('pointerdown', onGraphPointerDown);
    dom.graph.addEventListener('wheel', onGraphWheel, { passive: false });
    dom.nodeLayer.addEventListener('pointerdown', onNodePointerDown);
    dom.entityLayer.addEventListener('pointerdown', onEntityPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    dom.nodeLayer.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.node-card');
      if (!card) return;
      event.preventDefault();
      selectItem('node', card.dataset.nodeId);
    });

    dom.zoomInBtn.addEventListener('click', function () { zoomAt(null, null, 1.18); });
    dom.zoomOutBtn.addEventListener('click', function () { zoomAt(null, null, 0.84); });
    dom.fitBtn.addEventListener('click', fitGraph);

    dom.consoleToggleBtn.addEventListener('click', toggleConsole);
    dom.clearLogBtn.addEventListener('click', clearEventLog);

    dom.inspector.addEventListener('input', onInspectorInput);
    dom.inspector.addEventListener('change', onInspectorChange);
    dom.inspector.addEventListener('focusin', function (event) {
      if (event.target.matches('.formula-input')) lastFormulaInput = event.target;
    });

    document.addEventListener('click', function (event) {
      const actionElement = event.target.closest('[data-action]');
      if (actionElement) {
        event.preventDefault();
        handleAction(actionElement.dataset.action, actionElement);
      }
    });

    document.addEventListener('keydown', function (event) {
      const target = event.target;

      if (event.key === 'Escape') {
        if (dom.modalRoot.children.length) {
          closeModal();
          return;
        }
        if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
        if (selection.type) clearSelection();
        return;
      }

      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target instanceof HTMLElement && (target.matches('input, textarea, select, button, .node-card') || target.isContentEditable)) return;
      if (dom.modalRoot.children.length) return;
      event.preventDefault();
      toggleSimulation();
    });

    window.addEventListener('beforeunload', function () {
      if (saveTimer) {
        clearTimeout(saveTimer);
        try { Store.saveState(state); } catch (error) { /* noop */ }
      }
    });
  }

  function init() {
    buildSpeedButtons();
    bindEvents();
    renderPageSelect();
    renderEventLog();
    renderLists();
    renderGraph();
    renderInspector();
    updateControls();
    setSaveStatus('saved', 'Сохранено');

    requestAnimationFrame(function () {
      fitGraph();
      if (firstRun) {
        saveNow();
        toast('Демо-схема готова. Нажмите «Запустить», чтобы увидеть петлю в действии.', 'info', 6500);
      }
    });
  }

  // __APPEND_POINT__

  init();

})();

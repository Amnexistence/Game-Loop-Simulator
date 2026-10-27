/*
 * Data model, demo content, import sanitization and localStorage persistence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GLStore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'looplab.state.v1';
  const VERSION = 1;
  const SPEEDS = [0.25, 0.5, 1, 2, 4];
  const NODE_COLORS = ['#b8f36b', '#5eead4', '#7dd3fc', '#f0abfc', '#fbbf24', '#fb7185', '#a78bfa', '#34d399'];
  const ENTITY_COLORS = ['#b8f36b', '#5eead4', '#7dd3fc', '#f0abfc', '#fbbf24', '#fb7185', '#a78bfa', '#f97316'];

  let idCounter = 0;

  function uid(prefix) {
    idCounter += 1;
    const random = Math.random().toString(36).slice(2, 7);
    return prefix + '_' + Date.now().toString(36) + idCounter.toString(36) + random;
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function cleanText(value, fallback) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback || '';
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 160);
  }

  function cleanName(value, fallback) {
    const text = cleanText(value, fallback).trim();
    return text || fallback || 'Без названия';
  }

  function cleanFormula(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string') return '1';
    return value.slice(0, 500);
  }

  function cleanChance(value) {
    return clamp(finite(value, 100), 0, 100);
  }

  function optionalNumberString(value) {
    if (value === '' || value === null || value === undefined) return '';
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) ? String(number) : '';
  }

  function cleanColor(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  function clone(value) {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (error) {
        // fall through to JSON clone
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function nextName(base, names) {
    const used = new Set(names.map(function (name) { return String(name).toLowerCase(); }));
    if (!used.has(base.toLowerCase())) return base;
    let index = 2;
    while (used.has((base + ' ' + index).toLowerCase())) index += 1;
    return base + ' ' + index;
  }

  function uniquePageName(base, usedNames) {
    const used = new Set(Array.from(usedNames || []).map(function (name) { return String(name).toLowerCase(); }));
    let name = base;
    if (used.has(name.toLowerCase())) name = base + ' (импорт)';
    let index = 2;
    while (used.has(name.toLowerCase())) {
      name = base + ' (импорт ' + index + ')';
      index += 1;
    }
    return name;
  }

  function createParam(name, value) {
    return {
      id: uid('param'),
      name: name || 'параметр',
      value: finite(value, 0)
    };
  }

  function createEffect(paramName, formula, chance, op) {
    return {
      id: uid('effect'),
      paramName: paramName || '',
      op: ['add', 'multiply', 'set'].includes(op) ? op : 'add',
      formula: formula == null ? '1' : String(formula),
      chance: cleanChance(chance == null ? 100 : chance)
    };
  }

  function createInfluence(name, formula, chance) {
    return {
      id: uid('influence'),
      name: name || 'влияние',
      formula: formula == null ? '1' : String(formula),
      chance: cleanChance(chance == null ? 100 : chance)
    };
  }

  function createLink(targetId, influences) {
    return {
      id: uid('link'),
      targetId: targetId,
      influences: Array.isArray(influences) ? influences : [createInfluence()]
    };
  }

  function createEmptyConditions() {
    return {
      enabled: false,
      min: '',
      max: '',
      multiple: '',
      sources: [],
      allChances: false
    };
  }

  function createEntity(name, startNodeId, color) {
    return {
      id: uid('entity'),
      name: name || 'Сущность',
      color: cleanColor(color, ENTITY_COLORS[0]),
      startNodeId: startNodeId || null,
      params: []
    };
  }

  function createNode(name, x, y, color) {
    return {
      id: uid('node'),
      name: name || 'Нода',
      description: '',
      x: finite(x, 80),
      y: finite(y, 80),
      color: cleanColor(color, NODE_COLORS[0]),
      effects: [],
      links: [],
      conditions: createEmptyConditions()
    };
  }

  function createEmptyPage(name) {
    return {
      id: uid('page'),
      name: name || 'Новая схема',
      entities: [],
      nodes: []
    };
  }

  function createDemoPage() {
    const page = createEmptyPage('Петля игрока');

    const hp = createParam('hp', 100);
    const energy = createParam('energy', 50);
    const gold = createParam('gold', 0);
    const xp = createParam('xp', 0);

    const entity = createEntity('Игрок', null, '#b8f36b');
    entity.params = [hp, energy, gold, xp];

    const explore = createNode('Исследование', 80, 70, '#5eead4');
    explore.description = 'Разведка, сбор ресурсов и накопление риска.';
    explore.effects = [
      createEffect('energy', '-4', 100),
      createEffect('gold', '2', 80),
      createEffect('xp', '1', 100)
    ];

    const combat = createNode('Бой', 430, 40, '#fb7185');
    combat.description = 'Столкновение: расход здоровья и рост опыта.';
    combat.effects = [
      createEffect('hp', '-8', 100),
      createEffect('xp', '4', 100),
      createEffect('gold', '1', 55)
    ];
    combat.conditions = {
      enabled: true,
      min: '1',
      max: '',
      multiple: '',
      sources: [explore.id],
      allChances: false
    };

    const reward = createNode('Награда', 720, 260, '#b8f36b');
    reward.description = 'Добыча за цикл. Растёт вместе с опытом.';
    reward.effects = [
      createEffect('gold', '8 + min(5, floor({xp} / 20))', 100),
      createEffect('energy', '10', 100),
      createEffect('hp', '2', 100)
    ];
    reward.conditions = {
      enabled: true,
      min: '2',
      max: '',
      multiple: '',
      sources: [combat.id],
      allChances: false
    };

    const rest = createNode('Отдых', 260, 340, '#7dd3fc');
    rest.description = 'Восстановление перед новой итерацией.';
    rest.effects = [
      createEffect('energy', '6', 100),
      createEffect('hp', '4', 100)
    ];
    rest.conditions = {
      enabled: true,
      min: '1',
      max: '',
      multiple: '',
      sources: [reward.id],
      allChances: false
    };

    explore.links = [createLink(combat.id, [
      createInfluence('опасность', '1 + floor({energy} / 40)', 100)
    ])];
    combat.links = [createLink(reward.id, [
      createInfluence('добыча', '2 + floor({xp} / 10)', 100)
    ])];
    reward.links = [createLink(rest.id, [
      createInfluence('отдых', '1', 100)
    ])];
    rest.links = [createLink(explore.id, [
      createInfluence('мотивация', '1', 100)
    ])];

    page.nodes = [explore, combat, reward, rest];
    entity.startNodeId = explore.id;
    page.entities = [entity];
    return page;
  }

  function normalizeParam(raw, index, usedNames) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const fallbackName = 'параметр ' + (index + 1);
    let name = cleanName(item.name, fallbackName).replace(/[{}]/g, '').trim() || fallbackName;
    if (usedNames.has(name.toLowerCase())) {
      let suffix = 2;
      while (usedNames.has((name + ' ' + suffix).toLowerCase())) suffix += 1;
      name = name + ' ' + suffix;
    }
    usedNames.add(name.toLowerCase());
    return {
      id: uid('param'),
      name: name,
      value: finite(item.value, 0)
    };
  }

  function normalizePage(raw, options) {
    const opts = options || {};
    const source = raw && typeof raw === 'object' ? raw : {};
    const pageId = opts.preserveIds && typeof source.id === 'string' && source.id
      ? source.id
      : uid('page');
    const page = {
      id: pageId,
      name: cleanName(source.name, 'Импортированная схема'),
      entities: [],
      nodes: []
    };

    const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const nodeIdMap = new Map();
    const usedNodeIds = new Set();
    const usedEntityIds = new Set();

    const nodes = rawNodes.map(function (rawNode, nodeIndex) {
      const item = rawNode && typeof rawNode === 'object' ? rawNode : {};
      const oldId = typeof item.id === 'string' && item.id ? item.id : null;
      let nodeId;
      if (opts.preserveIds && oldId && !usedNodeIds.has(oldId)) {
        nodeId = oldId;
      } else {
        nodeId = uid('node');
      }
      usedNodeIds.add(nodeId);
      if (oldId && !nodeIdMap.has(oldId)) nodeIdMap.set(oldId, nodeId);

      const rawConditions = item.conditions && typeof item.conditions === 'object' ? item.conditions : {};
      const rawSources = Array.isArray(rawConditions.sources)
        ? rawConditions.sources.filter(function (value) { return typeof value === 'string'; })
        : [];

      const effects = (Array.isArray(item.effects) ? item.effects : []).map(function (rawEffect) {
        const effect = rawEffect && typeof rawEffect === 'object' ? rawEffect : {};
        return {
          id: uid('effect'),
          paramName: cleanText(effect.paramName, '').trim(),
          op: ['add', 'multiply', 'set'].includes(effect.op) ? effect.op : 'add',
          formula: cleanFormula(effect.formula),
          chance: cleanChance(effect.chance)
        };
      });

      return {
        id: nodeId,
        name: cleanName(item.name, 'Нода ' + (nodeIndex + 1)),
        description: cleanText(item.description, ''),
        x: finite(item.x, 80 + (nodeIndex % 3) * 300),
        y: finite(item.y, 80 + Math.floor(nodeIndex / 3) * 210),
        color: cleanColor(item.color, NODE_COLORS[nodeIndex % NODE_COLORS.length]),
        effects: effects,
        links: [],
        conditions: {
          enabled: Boolean(rawConditions.enabled),
          min: optionalNumberString(rawConditions.min),
          max: optionalNumberString(rawConditions.max),
          multiple: optionalNumberString(rawConditions.multiple),
          sources: rawSources,
          allChances: Boolean(rawConditions.allChances)
        }
      };
    });

    nodes.forEach(function (node, nodeIndex) {
      const item = rawNodes[nodeIndex] && typeof rawNodes[nodeIndex] === 'object' ? rawNodes[nodeIndex] : {};
      const rawLinksForNode = Array.isArray(item.links) ? item.links : [];
      const seenTargets = new Set();
      node.links = rawLinksForNode.map(function (rawLink) {
        const link = rawLink && typeof rawLink === 'object' ? rawLink : {};
        const targetId = typeof link.targetId === 'string' ? nodeIdMap.get(link.targetId) : null;
        if (!targetId || targetId === node.id || seenTargets.has(targetId)) return null;
        seenTargets.add(targetId);
        return {
          id: uid('link'),
          targetId: targetId,
          influences: (Array.isArray(link.influences) ? link.influences : []).map(function (rawInfluence) {
            const influence = rawInfluence && typeof rawInfluence === 'object' ? rawInfluence : {};
            return {
              id: uid('influence'),
              name: cleanText(influence.name, 'влияние').trim() || 'влияние',
              formula: cleanFormula(influence.formula),
              chance: cleanChance(influence.chance)
            };
          })
        };
      }).filter(Boolean);
    });

    // Resolve condition sources after every link has been restored.
    nodes.forEach(function (node) {
      const rawNode = rawNodes[nodes.indexOf(node)] && typeof rawNodes[nodes.indexOf(node)] === 'object'
        ? rawNodes[nodes.indexOf(node)]
        : {};
      const rawConditions = rawNode.conditions && typeof rawNode.conditions === 'object' ? rawNode.conditions : {};
      const rawSources = Array.isArray(rawConditions.sources)
        ? rawConditions.sources.filter(function (value) { return typeof value === 'string'; })
        : [];
      node.conditions.sources = Array.from(new Set(rawSources
        .map(function (oldSourceId) { return nodeIdMap.get(oldSourceId); })
        .filter(function (sourceId) {
          return Boolean(sourceId) && sourceId !== node.id && nodes.some(function (candidate) {
            return candidate.id === sourceId && candidate.links.some(function (link) {
              return link.targetId === node.id;
            });
          });
        })));
    });

    page.nodes = nodes;

    const rawEntities = Array.isArray(source.entities) ? source.entities : [];
    page.entities = rawEntities.map(function (rawEntity, entityIndex) {
      const item = rawEntity && typeof rawEntity === 'object' ? rawEntity : {};
      const oldId = typeof item.id === 'string' && item.id ? item.id : null;
      let entityId;
      if (opts.preserveIds && oldId && !usedEntityIds.has(oldId)) {
        entityId = oldId;
      } else {
        entityId = uid('entity');
      }
      usedEntityIds.add(entityId);

      const usedParamNames = new Set();
      const params = (Array.isArray(item.params) ? item.params : []).map(function (rawParam, index) {
        return normalizeParam(rawParam, index, usedParamNames);
      });

      return {
        id: entityId,
        name: cleanName(item.name, 'Сущность ' + (entityIndex + 1)),
        color: cleanColor(item.color, ENTITY_COLORS[entityIndex % ENTITY_COLORS.length]),
        startNodeId: typeof item.startNodeId === 'string' ? (nodeIdMap.get(item.startNodeId) || null) : null,
        params: params
      };
    });

    return page;
  }

  function createInitialState() {
    const page = createDemoPage();
    return {
      pages: [page],
      activePageId: page.id,
      speed: 1
    };
  }

  function loadState() {
    let raw = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) raw = JSON.parse(saved);
    } catch (error) {
      console.warn('LoopLab: не удалось прочитать localStorage', error);
      return null;
    }

    if (!raw || !Array.isArray(raw.pages) || !raw.pages.length) return null;

    const pages = raw.pages.map(function (page) {
      return normalizePage(page, { preserveIds: true });
    });

    if (!pages.length) return null;

    const usedPageIds = new Set();
    pages.forEach(function (page) {
      if (usedPageIds.has(page.id)) page.id = uid('page');
      usedPageIds.add(page.id);
    });

    let activePageId = typeof raw.activePageId === 'string' ? raw.activePageId : pages[0].id;
    if (!pages.some(function (page) { return page.id === activePageId; })) {
      activePageId = pages[0].id;
    }

    return {
      pages: pages,
      activePageId: activePageId,
      speed: SPEEDS.includes(Number(raw.speed)) ? Number(raw.speed) : 1
    };
  }

  function saveState(state) {
    const payload = {
      app: 'LoopLab',
      version: VERSION,
      savedAt: new Date().toISOString(),
      activePageId: state.activePageId,
      speed: state.speed,
      pages: state.pages
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  function exportPayload(pages) {
    return {
      app: 'LoopLab',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      pages: pages
    };
  }

  function extractPagesFromJSON(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.pages)) return data.pages;
    if (data && data.page && typeof data.page === 'object') return [data.page];
    if (data && typeof data === 'object' && (Array.isArray(data.nodes) || Array.isArray(data.entities))) return [data];
    return [];
  }

  function paramNames(page) {
    const names = [];
    const seen = new Set();
    (page.entities || []).forEach(function (entity) {
      (entity.params || []).forEach(function (param) {
        if (!seen.has(param.name)) {
          seen.add(param.name);
          names.push(param.name);
        }
      });
    });
    return names;
  }

  function hasParamName(page, name, exceptEntityId) {
    return (page.entities || []).some(function (entity) {
      if (exceptEntityId && entity.id === exceptEntityId) return false;
      return (entity.params || []).some(function (param) { return param.name === name; });
    });
  }

  function incomingSources(page, nodeId) {
    const sources = [];
    (page.nodes || []).forEach(function (node) {
      if ((node.links || []).some(function (link) { return link.targetId === nodeId; })) {
        sources.push(node);
      }
    });
    return sources;
  }

  return {
    STORAGE_KEY,
    VERSION,
    SPEEDS,
    NODE_COLORS,
    ENTITY_COLORS,
    uid,
    clone,
    finite,
    cleanColor,
    nextName,
    uniquePageName,
    createParam,
    createEffect,
    createInfluence,
    createLink,
    createEmptyConditions,
    createEntity,
    createNode,
    createEmptyPage,
    createDemoPage,
    createInitialState,
    normalizePage,
    loadState,
    saveState,
    exportPayload,
    extractPagesFromJSON,
    paramNames,
    hasParamName,
    incomingSources
  };
});

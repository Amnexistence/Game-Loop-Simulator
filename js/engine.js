/*
 * Deterministic-ish game loop simulation engine.
 * All mutation happens in plain JS objects; the UI layer owns animation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./expression'));
  } else {
    root.GLEngine = factory(root.GLExpression);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Expression) {
  'use strict';

  if (!Expression) {
    throw new Error('GLExpression is required');
  }

  const EPSILON = 0.000001;

  function numeric(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : (fallback == null ? 0 : fallback);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function emptyInfluence() {
    return {
      total: 0,
      byName: {},
      bySource: {}
    };
  }

  function ensureInfluence(sim, nodeId) {
    if (!sim.influences[nodeId]) {
      sim.influences[nodeId] = emptyInfluence();
    }
    return sim.influences[nodeId];
  }

  function createSimulation(page) {
    const nodes = Array.isArray(page && page.nodes) ? page.nodes : [];
    const entities = Array.isArray(page && page.entities) ? page.entities : [];
    const influences = {};

    nodes.forEach(function (node) {
      influences[node.id] = emptyInfluence();
    });

    const firstNodeId = nodes.length ? nodes[0].id : null;

    return {
      tick: 0,
      entities: entities.map(function (entity) {
        const params = {};
        (entity.params || []).forEach(function (param) {
          params[param.id] = numeric(param.value, 0);
        });
        return {
          id: entity.id,
          currentId: nodes.some(function (node) { return node.id === entity.startNodeId; })
            ? entity.startNodeId
            : firstNodeId,
          params,
          visits: 0
        };
      }),
      influences
    };
  }

  function syncSimulation(page, sim) {
    if (!sim) return null;

    const nodes = Array.isArray(page.nodes) ? page.nodes : [];
    const entities = Array.isArray(page.entities) ? page.entities : [];
    const nodeIds = new Set(nodes.map(function (node) { return node.id; }));
    const entityIds = new Set(entities.map(function (entity) { return entity.id; }));
    const firstNodeId = nodes.length ? nodes[0].id : null;

    Object.keys(sim.influences).forEach(function (nodeId) {
      if (!nodeIds.has(nodeId)) delete sim.influences[nodeId];
    });

    nodes.forEach(function (node) {
      ensureInfluence(sim, node.id);
    });

    sim.entities = sim.entities.filter(function (runtimeEntity) {
      return entityIds.has(runtimeEntity.id);
    });

    entities.forEach(function (entity) {
      let runtimeEntity = sim.entities.find(function (item) { return item.id === entity.id; });
      if (!runtimeEntity) {
        runtimeEntity = {
          id: entity.id,
          currentId: nodeIds.has(entity.startNodeId) ? entity.startNodeId : firstNodeId,
          params: {},
          visits: 0
        };
        sim.entities.push(runtimeEntity);
      }

      if (!nodeIds.has(runtimeEntity.currentId)) {
        runtimeEntity.currentId = nodeIds.has(entity.startNodeId) ? entity.startNodeId : firstNodeId;
      }

      const paramIds = new Set();
      (entity.params || []).forEach(function (param) {
        paramIds.add(param.id);
        if (!Object.prototype.hasOwnProperty.call(runtimeEntity.params, param.id)) {
          runtimeEntity.params[param.id] = numeric(param.value, 0);
        }
      });

      Object.keys(runtimeEntity.params).forEach(function (paramId) {
        if (!paramIds.has(paramId)) delete runtimeEntity.params[paramId];
      });
    });

    return sim;
  }

  function buildVariables(page, entity, runtimeEntity, node, sim) {
    const vars = {
      cycle: sim.tick,
      tick: sim.tick,
      visits: runtimeEntity.visits,
      influence: ensureInfluence(sim, node.id).total
    };

    (entity.params || []).forEach(function (param) {
      const raw = runtimeEntity.params[param.id];
      vars[param.name] = numeric(raw, numeric(param.value, 0));
    });

    return vars;
  }

  function readOptionalNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isMultiple(value, divisor) {
    const steps = value / divisor;
    return Math.abs(steps - Math.round(steps)) < 0.000001;
  }

  function checkConditions(page, node, sim) {
    const conditions = node.conditions || {};
    const result = {
      ok: true,
      enabled: Boolean(conditions.enabled),
      reasons: [],
      influence: ensureInfluence(sim, node.id).total
    };

    if (!result.enabled) return result;

    const influence = result.influence;
    const min = readOptionalNumber(conditions.min);
    const max = readOptionalNumber(conditions.max);
    const multiple = readOptionalNumber(conditions.multiple);

    if (min !== null && influence < min) {
      result.ok = false;
      result.reasons.push('влияние ' + Expression.formatNumber(influence) + ' < минимума ' + Expression.formatNumber(min));
    }

    if (max !== null && influence > max) {
      result.ok = false;
      result.reasons.push('влияние ' + Expression.formatNumber(influence) + ' > максимума ' + Expression.formatNumber(max));
    }

    if (multiple !== null && multiple > 0) {
      if (Math.abs(influence) < EPSILON) {
        result.ok = false;
        result.reasons.push('влияние равно нулю');
      } else if (!isMultiple(influence, multiple)) {
        result.ok = false;
        result.reasons.push('влияние не кратно ' + Expression.formatNumber(multiple));
      }
    }

    const sources = Array.isArray(conditions.sources) ? conditions.sources : [];
    if (sources.length) {
      const incoming = ensureInfluence(sim, node.id).bySource;
      const missing = sources.filter(function (sourceId) {
        return !incoming[sourceId] || Math.abs(incoming[sourceId].total) < EPSILON;
      });
      if (missing.length) {
        result.ok = false;
        result.reasons.push('ожидается влияние от ' + missing.length + ' источник(ов)');
      }
    }

    return result;
  }

  function rollChance(chance, rng) {
    const normalized = clamp(numeric(chance, 100), 0, 100);
    if (normalized >= 100) return { success: true, chance: normalized };
    if (normalized <= 0) return { success: false, chance: normalized };
    return { success: rng() * 100 < normalized, chance: normalized };
  }

  function addInfluence(sim, targetId, sourceId, name, amount) {
    if (!sim.influences[targetId]) {
      sim.influences[targetId] = emptyInfluence();
    }
    const target = sim.influences[targetId];
    const key = name || 'влияние';

    target.total += amount;
    target.byName[key] = numeric(target.byName[key], 0) + amount;

    if (!target.bySource[sourceId]) {
      target.bySource[sourceId] = { total: 0, byName: {} };
    }
    const source = target.bySource[sourceId];
    source.total += amount;
    source.byName[key] = numeric(source.byName[key], 0) + amount;
  }

  function formatDelta(amount) {
    const rounded = Math.round(amount * 1000) / 1000;
    return (rounded > 0 ? '+' : '') + Expression.formatNumber(rounded, 3);
  }

  function applyOperation(before, amount, operation) {
    if (operation === 'set') return amount;
    if (operation === 'multiply') return before * amount;
    return before + amount;
  }

  function step(page, sim, options) {
    const opts = options || {};
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const events = [];
    const applications = [];
    const pulses = [];
    const moves = [];

    sim.tick += 1;

    const nodesById = new Map((page.nodes || []).map(function (node) { return [node.id, node]; }));
    const entitiesById = new Map((page.entities || []).map(function (entity) { return [entity.id, entity]; }));

    sim.entities.forEach(function (runtimeEntity) {
      const entity = entitiesById.get(runtimeEntity.id);
      const node = nodesById.get(runtimeEntity.currentId);

      if (!entity || !node) {
        if (entity) {
          events.push({
            kind: 'idle',
            tone: 'muted',
            text: entity.name + ': не выбрана стартовая нода',
            entityId: entity.id,
            tick: sim.tick
          });
        }
        return;
      }

      const conditions = checkConditions(page, node, sim);
      const vars = buildVariables(page, entity, runtimeEntity, node, sim);

      events.push({
        kind: 'visit',
        tone: 'info',
        text: entity.name + ' проходит ноду «' + node.name + '»',
        nodeId: node.id,
        nodeName: node.name,
        entityId: entity.id,
        entityName: entity.name,
        tick: sim.tick
      });

      const effectItems = (node.effects || []).map(function (effect) {
        return { type: 'effect', item: effect };
      });
      const influenceItems = [];
      (node.links || []).forEach(function (link) {
        (link.influences || []).forEach(function (influence) {
          influenceItems.push({ type: 'influence', item: influence, link });
        });
      });

      const allChanceItems = effectItems.concat(influenceItems);
      const rolls = new Map();
      allChanceItems.forEach(function (entry) {
        rolls.set(entry.item.id, rollChance(entry.item.chance, rng));
      });

      let chancesPass = true;
      let failedChanceEntries = [];
      if (conditions.enabled && node.conditions && node.conditions.allChances) {
        allChanceItems.forEach(function (entry) {
          if (!rolls.get(entry.item.id).success) {
            chancesPass = false;
            failedChanceEntries.push(entry);
          }
        });
      }

      let shouldApply = conditions.ok && chancesPass;

      if (!conditions.ok) {
        events.push({
          kind: 'blocked',
          tone: 'warn',
          text: '«' + node.name + '» не сработала: ' + conditions.reasons.join('; '),
          nodeId: node.id,
          nodeName: node.name,
          tick: sim.tick
        });
      } else if (!chancesPass) {
        events.push({
          kind: 'blocked',
          tone: 'warn',
          text: '«' + node.name + '» не сработала: не выпали все шансы (' + failedChanceEntries.length + ')',
          nodeId: node.id,
          nodeName: node.name,
          tick: sim.tick
        });
      }

      if (shouldApply) {
        const effectList = node.effects || [];
        effectList.forEach(function (effect) {
          if (!rolls.get(effect.id).success) {
            events.push({
              kind: 'chance',
              tone: 'warn',
              text: 'Шанс ' + Expression.formatNumber(rolls.get(effect.id).chance, 1) + '% не сработал: '
                + effect.paramName + ' в «' + node.name + '»',
              nodeId: node.id,
              entityId: entity.id,
              tick: sim.tick
            });
            return;
          }

          const param = (entity.params || []).find(function (item) {
            return item.name === effect.paramName;
          });
          if (!param) return;

          const before = numeric(runtimeEntity.params[param.id], numeric(param.value, 0));
          let amount;
          try {
            amount = Expression.evaluate(effect.formula, vars);
          } catch (error) {
            events.push({
              kind: 'error',
              tone: 'bad',
              text: 'Ошибка формулы «' + effect.paramName + '» в «' + node.name + '»: ' + error.message,
              nodeId: node.id,
              entityId: entity.id,
              tick: sim.tick
            });
            return;
          }

          const after = applyOperation(before, amount, effect.op || 'add');
          runtimeEntity.params[param.id] = after;
          vars[param.name] = after;

          const operationSymbol = effect.op === 'multiply' ? '×' : effect.op === 'set' ? '=' : '';
          const deltaText = effect.op === 'set'
            ? Expression.formatNumber(after)
            : formatDelta(amount) + (effect.op === 'multiply' ? ' ×' : '');

          applications.push({
            entityId: entity.id,
            entityName: entity.name,
            nodeId: node.id,
            nodeName: node.name,
            paramName: param.name,
            amount,
            before,
            after,
            operation: effect.op || 'add'
          });

          events.push({
            kind: 'effect',
            tone: amount >= 0 ? 'good' : 'bad',
            text: entity.name + ': ' + param.name + ' ' + operationSymbol + deltaText
              + ' → ' + Expression.formatNumber(after, 3),
            nodeId: node.id,
            entityId: entity.id,
            tick: sim.tick
          });
        });

        (node.links || []).forEach(function (link) {
          const target = nodesById.get(link.targetId);
          if (!target) return;

          (link.influences || []).forEach(function (influence) {
            if (!rolls.get(influence.id).success) {
              events.push({
                kind: 'chance',
                tone: 'warn',
                text: 'Шанс ' + Expression.formatNumber(rolls.get(influence.id).chance, 1)
                  + '% не сработал: влияние «' + (influence.name || 'влияние') + '»',
                nodeId: node.id,
                tick: sim.tick
              });
              return;
            }

            let amount;
            try {
              amount = Expression.evaluate(influence.formula, vars);
            } catch (error) {
              events.push({
                kind: 'error',
                tone: 'bad',
                text: 'Ошибка формулы влияния «' + (influence.name || 'влияние') + '»: ' + error.message,
                nodeId: node.id,
                tick: sim.tick
              });
              return;
            }

            if (Math.abs(amount) < EPSILON) return;

            const name = influence.name || 'влияние';
            addInfluence(sim, target.id, node.id, name, amount);
            pulses.push({
              sourceId: node.id,
              targetId: target.id,
              linkId: link.id,
              influenceId: influence.id,
              name,
              amount
            });

            events.push({
              kind: 'influence',
              tone: amount >= 0 ? 'info' : 'warn',
              text: '«' + node.name + '» → «' + target.name + '»: '
                + formatDelta(amount) + ' ' + name,
              nodeId: node.id,
              targetNodeId: target.id,
              tick: sim.tick
            });
          });
        });
      }

      runtimeEntity.visits += 1;

      const validLinks = (node.links || []).filter(function (link) {
        return nodesById.has(link.targetId);
      });

      if (validLinks.length) {
        const chosen = validLinks[Math.floor(rng() * validLinks.length) % validLinks.length];
        const target = nodesById.get(chosen.targetId);
        const fromId = runtimeEntity.currentId;
        runtimeEntity.currentId = target.id;
        moves.push({
          entityId: entity.id,
          fromId,
          toId: target.id,
          linkId: chosen.id
        });
        events.push({
          kind: 'move',
          tone: 'muted',
          text: entity.name + ' → «' + target.name + '»',
          entityId: entity.id,
          nodeId: target.id,
          tick: sim.tick
        });
      } else {
        events.push({
          kind: 'idle',
          tone: 'muted',
          text: entity.name + ' остаётся в «' + node.name + '»: нет исходящих связей',
          entityId: entity.id,
          nodeId: node.id,
          tick: sim.tick
        });
      }
    });

    return {
      tick: sim.tick,
      conditionsOk: true,
      events,
      applications,
      pulses,
      moves
    };
  }

  function clearInfluences(sim) {
    if (!sim) return;
    Object.keys(sim.influences).forEach(function (nodeId) {
      sim.influences[nodeId] = emptyInfluence();
    });
  }

  function describeConditions(conditions) {
    if (!conditions || !conditions.enabled) return 'Без условий';
    const parts = [];
    if (conditions.min !== '' && conditions.min != null) parts.push('мин. ' + conditions.min);
    if (conditions.max !== '' && conditions.max != null) parts.push('макс. ' + conditions.max);
    if (conditions.multiple !== '' && conditions.multiple != null) parts.push('кратно ' + conditions.multiple);
    if (Array.isArray(conditions.sources) && conditions.sources.length) {
      parts.push('источников: ' + conditions.sources.length);
    }
    if (conditions.allChances) parts.push('все шансы');
    return parts.length ? parts.join(' · ') : 'Условия включены';
  }

  return {
    EPSILON,
    createSimulation,
    syncSimulation,
    step,
    checkConditions,
    clearInfluences,
    describeConditions,
    addInfluence,
    emptyInfluence
  };
});

/*
 * Safe math expression engine for formulas like:
 *   max(1, {energy} / 10) + 2
 *
 * Supported: numbers, {parameter names}, bare identifiers, + - * / % ^,
 * parentheses, and a small set of math functions. No eval() is used.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GLExpression = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cache = new Map();
  const CACHE_LIMIT = 300;

  const FUNCTIONS = {
    min: { min: 1, max: Infinity },
    max: { min: 1, max: Infinity },
    abs: { min: 1, max: 1 },
    round: { min: 1, max: 2 },
    floor: { min: 1, max: 1 },
    ceil: { min: 1, max: 1 },
    sqrt: { min: 1, max: 1 },
    pow: { min: 2, max: 2 },
    clamp: { min: 3, max: 3 },
    sign: { min: 1, max: 1 },
    log: { min: 1, max: 2 },
    exp: { min: 1, max: 1 },
    sin: { min: 1, max: 1 },
    cos: { min: 1, max: 1 },
    tan: { min: 1, max: 1 },
    random: { min: 0, max: 2 }
  };

  function isLetter(ch) {
    return /[\p{L}_]/u.test(ch);
  }

  function isLetterOrDigit(ch) {
    return /[\p{L}\p{N}_]/u.test(ch);
  }

  function tokenize(source) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const ch = source[index];

      if (/\s/.test(ch)) {
        index += 1;
        continue;
      }

      if (ch === '{') {
        const end = source.indexOf('}', index + 1);
        if (end === -1) {
          throw new Error('Не закрыта фигурная скобка переменной');
        }
        const name = source.slice(index + 1, end).trim();
        if (!name) {
          throw new Error('Пустое имя переменной');
        }
        tokens.push({ type: 'var', value: name, pos: index });
        index = end + 1;
        continue;
      }

      const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (numberMatch) {
        tokens.push({ type: 'number', value: Number(numberMatch[0]), pos: index });
        index += numberMatch[0].length;
        continue;
      }

      if (isLetter(ch)) {
        let end = index + 1;
        while (end < source.length && isLetterOrDigit(source[end])) {
          end += 1;
        }
        tokens.push({ type: 'ident', value: source.slice(index, end), pos: index });
        index = end;
        continue;
      }

      if ('+-*/%^(),'.includes(ch)) {
        tokens.push({ type: ch, value: ch, pos: index });
        index += 1;
        continue;
      }

      throw new Error('Неизвестный символ «' + ch + '»');
    }

    tokens.push({ type: 'eof', value: '', pos: source.length });
    return tokens;
  }

  function createParser(tokens) {
    let current = 0;

    function peek() {
      return tokens[current];
    }

    function consume(type) {
      const token = tokens[current];
      if (token.type !== type) {
        throw new Error('Ожидался «' + type + '»');
      }
      current += 1;
      return token;
    }

    function parseExpression() {
      return parseAdditive();
    }

    function parseAdditive() {
      let node = parseMultiplicative();
      while (peek().type === '+' || peek().type === '-') {
        const op = tokens[current].type;
        current += 1;
        node = { type: 'binary', op, left: node, right: parseMultiplicative() };
      }
      return node;
    }

    function parseMultiplicative() {
      let node = parsePower();
      while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
        const op = tokens[current].type;
        current += 1;
        node = { type: 'binary', op, left: node, right: parsePower() };
      }
      return node;
    }

    function parsePower() {
      const left = parseUnary();
      if (peek().type === '^') {
        current += 1;
        return { type: 'binary', op: '^', left, right: parsePower() };
      }
      return left;
    }

    function parseUnary() {
      if (peek().type === '+' || peek().type === '-') {
        const op = tokens[current].type;
        current += 1;
        return { type: 'unary', op, value: parseUnary() };
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const token = peek();

      if (token.type === 'number') {
        current += 1;
        return { type: 'number', value: token.value };
      }

      if (token.type === 'var') {
        current += 1;
        return { type: 'variable', name: token.value, explicit: true };
      }

      if (token.type === 'ident') {
        current += 1;
        const name = token.value;
        if (peek().type === '(') {
          const lower = name.toLowerCase();
          const spec = FUNCTIONS[lower];
          if (!spec) {
            throw new Error('Неизвестная функция «' + name + '»');
          }
          current += 1;
          const args = [];
          if (peek().type !== ')') {
            args.push(parseExpression());
            while (peek().type === ',') {
              current += 1;
              args.push(parseExpression());
            }
          }
          consume(')');
          if (args.length < spec.min || args.length > spec.max) {
            throw new Error('Неправильное число аргументов у «' + name + '»');
          }
          return { type: 'call', name: lower, args };
        }
        const lower = name.toLowerCase();
        if (lower === 'pi') return { type: 'number', value: Math.PI };
        if (lower === 'e') return { type: 'number', value: Math.E };
        return { type: 'variable', name, explicit: false };
      }

      if (token.type === '(') {
        current += 1;
        const node = parseExpression();
        consume(')');
        return node;
      }

      throw new Error('Неожиданный конец формулы');
    }

    const ast = parseExpression();
    if (peek().type !== 'eof') {
      throw new Error('Лишний символ «' + peek().value + '»');
    }
    return ast;
  }

  function readVariable(name, vars) {
    if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
      const value = Number(vars[name]);
      return Number.isFinite(value) ? value : 0;
    }
    return 0;
  }

  function evaluateAst(node, vars) {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'variable':
        return readVariable(node.name, vars);
      case 'unary':
        return node.op === '-' ? -evaluateAst(node.value, vars) : evaluateAst(node.value, vars);
      case 'binary': {
        const left = evaluateAst(node.left, vars);
        const right = evaluateAst(node.right, vars);
        switch (node.op) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/': return left / right;
          case '%': return left % right;
          case '^': return Math.pow(left, right);
          default: throw new Error('Неизвестный оператор');
        }
      }
      case 'call': {
        const args = node.args.map(function (arg) { return evaluateAst(arg, vars); });
        switch (node.name) {
          case 'min': return Math.min.apply(null, args);
          case 'max': return Math.max.apply(null, args);
          case 'abs': return Math.abs(args[0]);
          case 'round': {
            if (args.length === 1) return Math.round(args[0]);
            const factor = Math.pow(10, Math.trunc(args[1]));
            return Math.round(args[0] * factor) / factor;
          }
          case 'floor': return Math.floor(args[0]);
          case 'ceil': return Math.ceil(args[0]);
          case 'sqrt': return Math.sqrt(args[0]);
          case 'pow': return Math.pow(args[0], args[1]);
          case 'clamp': return Math.min(Math.max(args[0], args[1]), args[2]);
          case 'sign': return Math.sign(args[0]);
          case 'log': return args.length === 2 ? Math.log(args[0]) / Math.log(args[1]) : Math.log(args[0]);
          case 'exp': return Math.exp(args[0]);
          case 'sin': return Math.sin(args[0]);
          case 'cos': return Math.cos(args[0]);
          case 'tan': return Math.tan(args[0]);
          case 'random': {
            if (args.length === 0) return Math.random();
            if (args.length === 1) return Math.random() * args[0];
            return args[0] + Math.random() * (args[1] - args[0]);
          }
          default: throw new Error('Неизвестная функция');
        }
      }
      default:
        throw new Error('Некорректное выражение');
    }
  }

  function compile(source) {
    const key = String(source == null ? '' : source).trim();
    if (!key) throw new Error('Формула пуста');

    if (cache.has(key)) {
      return cache.get(key);
    }

    const ast = createParser(tokenize(key));
    const compiled = {
      source: key,
      ast,
      evaluate: function (vars) {
        const value = evaluateAst(ast, vars || {});
        if (!Number.isFinite(value)) {
          throw new Error('Результат формулы не является числом');
        }
        return value;
      }
    };

    if (cache.size >= CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, compiled);
    return compiled;
  }

  function evaluate(source, vars) {
    return compile(source).evaluate(vars || {});
  }

  function validate(source) {
    try {
      compile(source);
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function formatNumber(value, maxDigits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    const digits = maxDigits == null ? 2 : maxDigits;
    const rounded = Math.round(number * Math.pow(10, digits)) / Math.pow(10, digits);
    return new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: digits
    }).format(rounded);
  }

  return {
    compile,
    evaluate,
    validate,
    formatNumber,
    functions: Object.keys(FUNCTIONS)
  };
});

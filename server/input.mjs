export class InputError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

export function requireThat(condition, message) {
  if (!condition) throw new InputError(message);
}

export function object(value, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${label} 必须是对象`);
  return value;
}

export function list(value, min, max, label) {
  requireThat(Array.isArray(value) && value.length >= min && value.length <= max, `${label} 需要 ${min}–${max} 项`);
  return value;
}

export function number(value, min, max, label, integer = false) {
  requireThat(Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)),
    `${label} 需要 ${min}–${max} 的${integer ? '整数' : '数值'}`);
  return value;
}

export function choice(value, allowed, label) {
  requireThat(allowed.includes(value), `${label} 允许：${allowed.join('、')}`);
  return value;
}

export function key(value, label = '标识') {
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9][\w-]{0,31}$/.test(value), `${label} 使用 1–32 位英数、下划线或连字符`);
  return value;
}

export function unique(rows, label) {
  requireThat(new Set(rows.map(row => row.id)).size === rows.length, `${label} 的标识不得重复`);
  return rows;
}

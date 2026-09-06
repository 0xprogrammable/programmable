/** Canonical UTF-8 JSON: sorted object keys, no whitespace, no coercion or omitted values. */
export function canonicalJson(value) {
  const ancestors = new Set();
  function serialize(item, depth) {
    if (depth > 32) throw new TypeError('JSON nesting exceeds 32 levels');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new TypeError('JSON numbers must be safe integers');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw new TypeError('Expected acyclic JSON data');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Expected a plain JSON object');
    }
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new TypeError('Sparse arrays are not JSON data');
      result = `[${item.map((entry) => serialize(entry, depth + 1)).join(',')}]`;
    } else {
      result = `{${Object.keys(item).sort().map((key) => {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Reserved JSON property');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (descriptor.get || descriptor.set) throw new TypeError('JSON properties cannot be accessors');
        return `${JSON.stringify(key)}:${serialize(item[key], depth + 1)}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return serialize(value, 0);
}

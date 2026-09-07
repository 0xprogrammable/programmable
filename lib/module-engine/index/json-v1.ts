/** Accept inert, bounded JSON only. This is a DTO boundary, not a sandbox for arbitrary JS proxies. */
export function nativeJson(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
    if (++budget.nodes > 100000 || depth > 40)
        throw new Error("Module data exceeds the JSON limit.");
    if (value === null || typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        if (value.length > 262144)
            throw new Error("Module text exceeds the JSON limit.");
        return value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value))
        return value;
    if (!value || typeof value !== "object" || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new Error("Module data must be plain JSON.");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key !== "string") || Object.keys(descriptors).some(key => !("value" in descriptors[key]!) || (!descriptors[key]!.enumerable && key !== "length")))
        throw new Error("Module data must not contain accessors.");
    if (Array.isArray(value)) {
        if (value.length > 2048 || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1
            || Array.from({ length: value.length }, (_, index) => descriptors[String(index)]).some(item => !item || !("value" in item)))
            throw new Error("Invalid module array.");
        return value.map(item => nativeJson(item, depth + 1, budget));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nativeJson(item, depth + 1, budget)]));
}
export function nativeCanonicalJson(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(nativeCanonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${nativeCanonicalJson(item)}`).join(",")}}`;
    return JSON.stringify(value);
}

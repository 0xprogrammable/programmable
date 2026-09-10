import { encodeAbiParameters, type AbiParameter, type Hex } from "viem";
import { assertOpenConfigSchema, type OpenCompiledConfig, type OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import type { ModuleEngineConfigurationArgument, ModuleEngineConfigurationComponent } from "./catalog";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleRecord } from "@/lib/module-mode/release";

/** Closed, inert shape validation also works before a source schema is available to the review plan parser. */
export function parseModuleEngineConfigurationAbi(value: unknown): readonly ModuleEngineConfigurationArgument[] {
  const raw = nativeJson(value); if (!Array.isArray(raw) || raw.length > 128) throw new Error("Invalid engine configuration ABI.");
  let nodes = 0;
  function inspect(value: unknown, depth: number, root: boolean): void {
    if (++nodes > 256 || depth > 12 || !value || typeof value !== "object") throw new Error("Engine configuration ABI exceeds its structural limit.");
    const object = value as Record<string, unknown>, arg = moduleRecord(object, [root ? "path" : "name", "type", ...(Object.hasOwn(object, "components") ? ["components"] : [])], "engine.configurationAbi");
    const reserved = ["__proto__", "prototype", "constructor"];
    if (root) { if (!Array.isArray(arg.path) || arg.path.length > 16 || arg.path.some(key => typeof key !== "string" || !/^(?:[A-Za-z_][A-Za-z0-9_]{0,63}|0|[1-9][0-9]{0,2})$/.test(key) || reserved.includes(key))) throw new Error("Invalid engine configuration path."); }
    else if (typeof arg.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(arg.name) || reserved.includes(arg.name)) throw new Error("Engine tuple components require names.");
    if (typeof arg.type !== "string" || arg.type.length > 128 || !/^(?:tuple|address|bool|string|bytes(?:[1-9]|[12][0-9]|3[0-2])?|int24|uint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?)(?:\[(?:[1-9][0-9]{0,2})?\])*$/.test(arg.type)) throw new Error("Unsupported engine configuration ABI type.");
    const dimensions = [...arg.type.matchAll(/\[([0-9]*)\]/g)]; if (dimensions.length + depth > 12 || dimensions.some(item => item[1] && Number(item[1]) > 256)) throw new Error("Engine ABI array exceeds its bound.");
    if (arg.type.split("[")[0] === "tuple") {
      if (!Array.isArray(arg.components) || arg.components.length < 1 || arg.components.length > 64) throw new Error("Engine tuple needs named components.");
      const names = new Set<string>(); for (const component of arg.components) { inspect(component, depth + 1 + dimensions.length, false); const name = (component as ModuleEngineConfigurationComponent).name; if (names.has(name)) throw new Error("Duplicate engine tuple component."); names.add(name); }
    } else if (Object.hasOwn(arg, "components")) throw new Error("Primitive engine ABI fields cannot declare components.");
  }
  raw.forEach(item => inspect(item, 0, true)); return raw as unknown as readonly ModuleEngineConfigurationArgument[];
}

/** Engine-only named tuple mapping; primitive mappings retain the existing native ABI bytes. */
export function validateModuleEngineConfigurationAbi(schema: OpenConfigSchema, mapping: readonly ModuleEngineConfigurationArgument[]): void {
  assertOpenConfigSchema(schema);
  parseModuleEngineConfigurationAbi(mapping);
  function nodeAt(path: readonly string[]) { let node = schema; for (const key of path) { if (node.type === "record" && node.fields[key]) node = node.fields[key]; else if (node.type === "array" && /^(?:0|[1-9][0-9]*)$/.test(key)) node = node.items; else throw new Error("Engine ABI path is not in the configuration schema."); } return node; }
  let count = 0;
  function inspect(type: string, node: OpenConfigSchema, components: readonly ModuleEngineConfigurationComponent[] | undefined, depth: number): void {
    if (++count > 256 || depth > 12) throw new Error("Engine configuration ABI exceeds its structural limit.");
    const array = /^(.*)\[([0-9]*)\]$/.exec(type);
    if (array) { if (node.type !== "array") throw new Error("Engine ABI array requires an array schema."); inspect(array[1], node.items, components, depth + 1); return; }
    if (type === "tuple") {
      if (node.type !== "record" || !components || components.length < 1 || components.length > 64 || new Set(components.map(item => item.name)).size !== components.length || components.length !== Object.keys(node.fields).length || components.some(item => !Object.hasOwn(node.fields, item.name))) throw new Error("Engine ABI tuple must cover each configuration field exactly once.");
      for (const item of components) inspect(item.type, node.fields[item.name], item.components, depth + 1); return;
    }
    if (components !== undefined) throw new Error("Primitive engine ABI fields cannot declare components.");
    const compatible = type === "int24" ? node.type === "string" && node.maxLength <= 8 : /^uint(?:[0-9]+)?$/.test(type) ? node.type === "uint" : type === "address" ? ["address", "account", "asset", "component"].includes(node.type) : type === "bool" ? node.type === "bool" : type === "string" ? node.type === "string" : /^bytes(?:[0-9]+)?$/.test(type) && node.type === "bytes";
    if (!compatible) throw new Error("Engine ABI type does not match the configuration schema.");
  }
  for (const arg of mapping) inspect(arg.type, nodeAt(arg.path), arg.components, 0);
}
export function encodeModuleEngineConfiguration(mapping: readonly ModuleEngineConfigurationArgument[], config: OpenCompiledConfig, schema: OpenConfigSchema): Hex {
  validateModuleEngineConfigurationAbi(schema, mapping);
  const pointer = (path: readonly string[]) => path.map(key => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
  function get(path: readonly string[]) { let value: unknown = config.value; for (const key of path) value = (value as Record<string, unknown>)?.[key]; return value; }
  function normalize(type: string, path: readonly string[], components?: readonly ModuleEngineConfigurationComponent[]): unknown {
    const value = get(path), array = /^(.*)\[([0-9]*)\]$/.exec(type);
    if (array) { if (!Array.isArray(value) || (array[2] && value.length !== Number(array[2]))) throw new Error("Engine configuration array differs from the reviewed ABI."); return value.map((_, i) => normalize(array[1], [...path, String(i)], components)); }
    if (type === "tuple") { if (!components || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Engine tuple needs a named configuration record."); return Object.fromEntries(components.map(item => [item.name, normalize(item.type, [...path, item.name], item.components)])); }
    if (/^uint(?:[0-9]+)?$/.test(type)) return BigInt(String(value));
    if (type === "int24") {
      if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) throw new Error("Signed tick must be a canonical decimal integer.");
      const signed = BigInt(value);
      if (signed < -(1n << 23n) || signed >= (1n << 23n)) throw new Error("Signed tick exceeds int24.");
      return signed;
    }
    if (type === "address") {
      if (typeof value === "string") return value;
      const binding = config.bindings.find(item => item.path === pointer(path));
      if (binding) return binding.kind === "asset" ? binding.resolved.address : binding.resolved;
      if (value && typeof value === "object" && "address" in value) return value.address;
      throw new Error("Bind this configuration address to the current wallet or asset.");
    }
    return value;
  }
  function parameter(arg: { type: string; components?: readonly ModuleEngineConfigurationComponent[]; name?: string }): AbiParameter { return { type: arg.type, ...(arg.name === undefined ? {} : { name: arg.name }), ...(arg.components ? { components: arg.components.map(parameter) } : {}) } as AbiParameter; }
  return encodeAbiParameters(mapping.map(parameter), mapping.map(arg => normalize(arg.type, arg.path, arg.components)));
}

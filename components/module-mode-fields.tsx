"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  asFormRecord,
  DURATION_UNITS,
  defaultSchemaValue,
  configurationSummary,
  configurationToForm,
  type BuilderIssue,
  type FieldDisplay,
  type FormValue,
  type OpenConfigContext,
  type OpenConfigSchema,
} from "@/lib/module-mode/builder";
import { resolveOpenConfigBindings } from "@/packages/classic-modules/src/open-config.mjs";
import styles from "@/components/module-mode-builder.module.css";

interface SchemaFieldProps {
  schema: OpenConfigSchema;
  value: FormValue;
  onChange: (value: FormValue) => void;
  label?: string;
  path: string;
  schemaPath?: string;
  fields?: Record<string, FieldDisplay>;
  issues?: BuilderIssue[];
  context?: OpenConfigContext;
}

export function moduleFieldId(path: string) { return `module-field-${encodeURIComponent(path)}`; }
function childPath(path: string, key: string | number) { return `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`; }
function readable(key: string) { return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()); }

/** All module configuration controls come from the open schema, not module names. */
export function ModuleSchemaField({ schema, value, onChange, label, path, schemaPath = "", fields = {}, issues = [], context = {} }: SchemaFieldProps) {
  const savedOptional = useRef<Record<string, FormValue>>({});
  const savedVariants = useRef<Record<string, FormValue>>({});
  const savedAccounts = useRef<Record<string, FormValue>>({});
  const [removedItem, setRemovedItem] = useState<{ value: FormValue; index: number } | null>(null);
  const title = schema.label ?? label ?? "Configuration";
  const id = moduleFieldId(path);
  const issue = issues.find((item) => item.path === path);
  const describedBy = [schema.help ? `${id}-help` : "", issue ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const shared = { fields, issues, context };

  if (schema.binding?.mode === "fixed") {
    let rows: ReturnType<typeof configurationSummary> | null = null;
    try {
      const fixed = resolveOpenConfigBindings(schema, undefined, context);
      rows = configurationSummary(schema, configurationToForm(schema, fixed.value, fields, schemaPath), fields, title, schemaPath, fixed.bindings);
    } catch { /* Invalid published bindings remain a visible validation error. */ }
    if (!rows) return <p className={styles.fieldError} role="alert">The fixed template value could not be verified. Refresh the catalog before reviewing.</p>;
    return <div className={styles.field} aria-describedby={describedBy}><span>{title} <small>Fixed by template</small></span><dl className={styles.reviewRows}>{rows.map((row, index) => <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>{schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}{issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>;
  }

  if (schema.type === "record") {
    const record = asFormRecord(value);
    const children = (
      <div className={styles.recordFields}>
        {Object.entries(schema.fields).map(([key, field]) => {
          const optional = !schema.required.includes(key) && field.binding?.mode !== "fixed";
          const present = Object.hasOwn(record, key);
          const fieldPath = childPath(path, key);
          return (
            <div className={styles.recordField} key={key}>
              {optional ? (
                <label className={styles.optionalToggle}>
                  <input type="checkbox" checked={present} onChange={(event) => {
                    const next = { ...record };
                    if (event.target.checked) next[key] = savedOptional.current[key] ?? defaultSchemaValue(field, fields, childPath(schemaPath, key));
                    else { savedOptional.current[key] = record[key]; delete next[key]; }
                    onChange(next);
                  }} />
                  <span>Use {field.label ?? readable(key)} <small>Optional</small></span>
                </label>
              ) : null}
              {present || !optional ? (
                <ModuleSchemaField {...shared} schema={field} value={record[key] ?? defaultSchemaValue(field, fields, childPath(schemaPath, key))} onChange={(next) => onChange({ ...record, [key]: next })} label={readable(key)} path={fieldPath} schemaPath={childPath(schemaPath, key)} />
              ) : null}
            </div>
          );
        })}
      </div>
    );
    return label || schema.label ? <fieldset className={styles.collection}><legend>{title}</legend>{schema.help ? <p className={styles.help}>{schema.help}</p> : null}{children}</fieldset> : children;
  }

  if (schema.type === "array") {
    const values = Array.isArray(value) ? value : [];
    return (
      <fieldset className={styles.collection} aria-describedby={describedBy}>
        <legend>{title}</legend>
        {schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}
        {values.map((item, index) => (
          <div key={index} className={styles.collectionItem}>
            <div className={styles.collectionHeader}>
              <span>{title} {index + 1}</span>
              <button type="button" className={styles.iconButton} aria-label={`Remove ${title} ${index + 1}`} disabled={values.length <= (schema.minItems ?? 0)} onClick={() => { setRemovedItem({ value: item, index }); onChange(values.filter((_, candidate) => candidate !== index)); }}><Trash2 size={16} aria-hidden="true" /></button>
            </div>
            <ModuleSchemaField {...shared} schema={schema.items} value={item} onChange={(next) => onChange(values.map((old, candidate) => candidate === index ? next : old))} label={`${title} ${index + 1}`} path={childPath(path, index)} schemaPath={`${schemaPath}/*`} />
          </div>
        ))}
        <div className={styles.collectionActions}>
          <button type="button" className={styles.textButton} disabled={values.length >= schema.maxItems} onClick={() => onChange([...values, defaultSchemaValue(schema.items, fields, `${schemaPath}/*`)])}><Plus size={16} aria-hidden="true" /> Add item</button>
          {removedItem ? <button type="button" className={styles.textButton} disabled={values.length >= schema.maxItems} onClick={() => { const next = [...values]; next.splice(removedItem.index, 0, removedItem.value); onChange(next); setRemovedItem(null); }}>Undo removal</button> : null}
        </div>
        {issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}
      </fieldset>
    );
  }

  if (schema.type === "variant") {
    const record = asFormRecord(value);
    const branch = typeof record[schema.tag] === "string" ? String(record[schema.tag]) : Object.keys(schema.variants)[0];
    const branchSchema = schema.variants[branch];
    const children = { ...record }; delete children[schema.tag];
    return (
      <div className={styles.variant}>
        <div className={styles.field}>
          <label htmlFor={id}>{title}</label>
          <select id={id} value={branch} aria-invalid={Boolean(issue) || undefined} aria-describedby={describedBy} onChange={(event) => {
            savedVariants.current[branch] = children;
            const selected = event.target.value;
            onChange({ [schema.tag]: selected, ...asFormRecord(savedVariants.current[selected] ?? defaultSchemaValue(schema.variants[selected], fields, `${schemaPath}/${selected}`)) });
          }}>
            {Object.entries(schema.variants).map(([key, variant]) => <option key={key} value={key}>{variant.label ?? readable(key)}</option>)}
          </select>
          {schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}
          {issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}
        </div>
        {branchSchema ? <ModuleSchemaField {...shared} schema={branchSchema} value={children} onChange={(next) => onChange({ [schema.tag]: branch, ...asFormRecord(next) })} path={path} schemaPath={`${schemaPath}/${branch}`} /> : null}
      </div>
    );
  }

  if (schema.type === "bool") {
    return <div className={styles.field}><label className={styles.optionalToggle}><input id={id} type="checkbox" checked={value === true} aria-invalid={Boolean(issue) || undefined} aria-describedby={describedBy} onChange={(event) => onChange(event.target.checked)} /><span>{title}</span></label>{schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}{issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>;
  }

  if (schema.type === "account") {
    const record = asFormRecord(value);
    const role = Object.hasOwn(record, "role");
    const roles = Object.keys(context.roles ?? {});
    return (
      <fieldset className={styles.collection}>
        <legend>{title}</legend>
        {roles.length > 0 || role ? <div className={styles.field}>
          <label htmlFor={`${id}-kind`}>Use</label>
          <select id={`${id}-kind`} value={role ? "role" : "address"} onChange={(event) => {
            savedAccounts.current[role ? "role" : "address"] = record;
            const kind = event.target.value;
            onChange(savedAccounts.current[kind] ?? (kind === "role" ? { role: roles[0] ?? "" } : { address: "" }));
          }}>
            <option value="address">Wallet address</option>
            <option value="role" disabled={roles.length === 0}>Named role{roles.length === 0 ? " · none supplied" : ""}</option>
          </select>
        </div> : null}
        <div className={styles.field}>
          <label htmlFor={id}>{role ? "Role" : "Wallet address"}</label>
          {role ? <select id={id} value={String(record.role ?? "")} aria-invalid={Boolean(issue) || undefined} aria-describedby={describedBy} onChange={(event) => onChange({ role: event.target.value })}><option value="">Choose a role</option>{roles.map((key) => <option value={key} key={key}>{key}</option>)}</select> : <input id={id} type="text" spellCheck={false} autoComplete="off" placeholder="0x…" value={String(record.address ?? "")} aria-invalid={Boolean(issue) || undefined} aria-describedby={describedBy} onChange={(event) => onChange({ address: event.target.value })} />}
          {schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}
          {issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}
        </div>
      </fieldset>
    );
  }

  if (schema.type === "asset" || schema.type === "component") {
    const kind = schema.type;
    const options = Object.keys(kind === "asset" ? context.assets ?? {} : context.components ?? {});
    const selected = asFormRecord(value)[kind];
    return <div className={styles.field}><label htmlFor={id}>{title}</label><select id={id} value={typeof selected === "string" ? selected : ""} aria-invalid={Boolean(issue) || undefined} aria-describedby={`${id}-help${issue ? ` ${id}-error` : ""}`} onChange={(event) => onChange({ [kind]: event.target.value })}><option value="">{options.length ? `Choose a ${kind}` : `No ${kind}s supplied`}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><p id={`${id}-help`} className={styles.help}>{schema.help ?? "The exact address must be supplied before this configuration can be reviewed."}</p>{issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>;
  }

  const display = fields[schemaPath];
  if (schema.type === "uint" && display?.input === "duration") {
    const duration = typeof value === "string" ? { amount: value, unit: "seconds" } : asFormRecord(value);
    return <div className={styles.field}><label htmlFor={id}>{title}</label><div className={styles.durationInput}><input id={id} type="text" inputMode="decimal" value={String(duration.amount ?? "")} aria-invalid={Boolean(issue) || undefined} aria-describedby={describedBy} onChange={(event) => onChange({ ...duration, amount: event.target.value })} /><select value={String(duration.unit ?? "seconds")} aria-label={`${title} unit`} onChange={(event) => onChange({ ...duration, unit: event.target.value })}>{Object.keys(DURATION_UNITS).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div>{schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}{issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>;
  }
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{title}</label>
      <div className={styles.inputWithUnit}>
        <input id={id} type={display?.input === "datetime-utc" ? "datetime-local" : "text"} value={typeof value === "string" ? value : ""} inputMode={schema.type === "uint" ? display?.decimals ? "decimal" : "numeric" : "text"} autoComplete="off" spellCheck={schema.type === "string"} placeholder={display?.placeholder ?? (schema.type === "address" ? "0x…" : undefined)} aria-label={display?.suffix ? `${title} (${display.suffix})` : undefined} aria-invalid={Boolean(issue) || undefined} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)} />
        {display?.suffix ? <span aria-hidden="true">{display.suffix}</span> : null}
      </div>
      {schema.help ? <p id={`${id}-help`} className={styles.help}>{schema.help}</p> : null}
      {issue ? <p id={`${id}-error`} className={styles.fieldError}>{issue.message}</p> : null}
    </div>
  );
}

import { useMemo, useState } from 'react'
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { isModelProperty } from '@electric-ax/agents-server-ui/src/lib/modelCapabilities'
import {
  isObjectSchema,
  modelOptionLabel,
  modelProviderKey,
  MODEL_PROVIDER_LABELS,
  stringArrayToDisplay,
} from '@electric-ax/agents-server-ui/src/lib/schemaProperties'
import type { SchemaProperty } from '@electric-ax/agents-server-ui/src/lib/schemaProperties'
import { BottomSheet, BottomSheetItem, BottomSheetSection } from './BottomSheet'
import { Icon } from './Icon'
import { useTokens } from '../lib/ThemeProvider'
import {
  arrayFieldEntries,
  coerceTextFieldValue,
  inlineArgProperties,
  objectFieldEntries,
  textFieldEntries,
} from '../lib/spawnArgs'
import { persistLastPickedModel } from '../lib/lastPickedModel'
import {
  fontSize,
  lineHeight,
  monoFontFamily,
  radii,
  spacing,
} from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Renders an entity type's `creation_schema` as native spawn-arg controls,
 * mirroring the desktop `SchemaForm` / `DefaultAgentComposer`: enums become
 * picker pills (the model enum groups by provider and remembers the pick),
 * booleans become switches, string/number become text fields, string-arrays a
 * comma-separated field, and other objects a JSON field. Values are held by the
 * parent so the collected object can be sent as spawn `args`.
 */
export function SchemaArgsControls({
  schema,
  args,
  onChange,
  omitKeys,
  disabled,
}: {
  schema: unknown
  args: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  /** Keys handled elsewhere (e.g. `workingDirectory` has its own picker). */
  omitKeys?: ReadonlyArray<string>
  disabled?: boolean
}): React.ReactElement | null {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const inlineProps = useMemo(
    () => inlineArgProperties(schema, omitKeys),
    [schema, omitKeys]
  )
  const textProps = useMemo(
    () => textFieldEntries(schema, omitKeys),
    [schema, omitKeys]
  )
  const arrayProps = useMemo(
    () => arrayFieldEntries(schema, omitKeys),
    [schema, omitKeys]
  )
  const objectProps = useMemo(
    () => objectFieldEntries(schema, omitKeys),
    [schema, omitKeys]
  )
  const requiredKeys = useMemo(
    () => new Set(isObjectSchema(schema) ? (schema.required ?? []) : []),
    [schema]
  )

  if (
    inlineProps.length === 0 &&
    textProps.length === 0 &&
    arrayProps.length === 0 &&
    objectProps.length === 0
  ) {
    return null
  }

  return (
    <View style={styles.group}>
      {inlineProps.map(({ key, prop }) =>
        prop.enum && prop.enum.length > 0 ? (
          <EnumArgPill
            key={key}
            propKey={key}
            prop={prop}
            value={args[key]}
            onChange={onChange}
            clearable={!requiredKeys.has(key)}
            disabled={disabled}
          />
        ) : prop.type === `boolean` ? (
          <BoolArgRow
            key={key}
            propKey={key}
            prop={prop}
            value={Boolean(args[key])}
            onChange={onChange}
            disabled={disabled}
          />
        ) : null
      )}
      {textProps.map(({ key, prop }) => (
        <TextArgRow
          key={key}
          propKey={key}
          prop={prop}
          value={args[key]}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
      {arrayProps.map(({ key, prop }) => (
        <ArrayArgRow
          key={key}
          propKey={key}
          prop={prop}
          value={args[key]}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
      {objectProps.map(({ key, prop }) => (
        <JsonArgRow
          key={key}
          propKey={key}
          prop={prop}
          value={args[key]}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
    </View>
  )
}

/** A schema key as a readable label: `reasoningEffort` → `Reasoning Effort`. */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, `$1 $2`)
    .replace(/[_-]+/g, ` `)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(` `)
}

function fieldLabel(propKey: string, prop: SchemaProperty): string {
  return prop.title ?? humanizeKey(propKey)
}

function providerLabel(provider: string): string {
  return MODEL_PROVIDER_LABELS[provider] ?? humanizeKey(provider)
}

function optionLabel(value: string, isModel: boolean): string {
  if (isModel) return modelOptionLabel(value)
  // Title-case enum values (`auto` → `Auto`), mirroring desktop.
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(` `)
}

function EnumArgPill({
  propKey,
  prop,
  value,
  onChange,
  clearable,
  disabled,
}: {
  propKey: string
  prop: SchemaProperty
  value: unknown
  onChange: (key: string, value: unknown) => void
  /** Optional enums can be unset (the desktop Select's clearable `—` item). */
  clearable?: boolean
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [open, setOpen] = useState(false)
  const isModel = isModelProperty(propKey)
  const label = fieldLabel(propKey, prop)
  const options = useMemo(() => (prop.enum ?? []).map(String), [prop.enum])
  const current = value === undefined || value === null ? `` : String(value)

  // Group model options by provider so a long catalog stays scannable; other
  // enums render as a single flat list.
  const groups = useMemo(() => {
    if (!isModel) return [{ provider: null as string | null, options }]
    const byProvider = new Map<string, Array<string>>()
    for (const option of options) {
      const provider = modelProviderKey(option)
      const list = byProvider.get(provider) ?? []
      list.push(option)
      byProvider.set(provider, list)
    }
    return Array.from(byProvider, ([provider, list]) => ({
      provider,
      options: list,
    }))
  }, [isModel, options])

  const select = (option: string): void => {
    const original = prop.enum?.find((v) => String(v) === option) ?? option
    if (isModel) persistLastPickedModel(option)
    onChange(propKey, original)
    setOpen(false)
  }

  return (
    <>
      <Pressable
        onPress={() => {
          Keyboard.dismiss()
          setOpen(true)
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current || `choose`}`}
        style={({ pressed }) => [
          styles.pill,
          pressed && !disabled ? styles.pillPressed : null,
          disabled ? styles.controlDisabled : null,
        ]}
      >
        <Text style={styles.pillLabel}>{label}</Text>
        <Text style={styles.pillValue} numberOfLines={1}>
          {current ? optionLabel(current, isModel) : `Choose`}
        </Text>
        <Icon name="chevron-down" size={14} color={tokens.text3} />
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={styles.sheetScroll} nestedScrollEnabled>
          {clearable && (
            <BottomSheetItem
              label="None"
              active={current === ``}
              onPress={() => {
                onChange(propKey, undefined)
                setOpen(false)
              }}
            />
          )}
          {groups.map((group) => (
            <BottomSheetSection
              key={group.provider ?? `__all__`}
              label={group.provider ? providerLabel(group.provider) : undefined}
            >
              {group.options.map((option) => (
                <BottomSheetItem
                  key={option}
                  label={optionLabel(option, isModel)}
                  active={option === current}
                  onPress={() => select(option)}
                />
              ))}
            </BottomSheetSection>
          ))}
        </ScrollView>
      </BottomSheet>
    </>
  )
}

function BoolArgRow({
  propKey,
  prop,
  value,
  onChange,
  disabled,
}: {
  propKey: string
  prop: SchemaProperty
  value: boolean
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <View style={[styles.boolRow, disabled ? styles.controlDisabled : null]}>
      <View style={styles.boolText}>
        <Text style={styles.pillLabel}>{fieldLabel(propKey, prop)}</Text>
        {prop.description ? (
          <Text style={styles.fieldHint} numberOfLines={2}>
            {prop.description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(propKey, next)}
        trackColor={{ true: tokens.accent9, false: tokens.gray7 }}
        thumbColor={tokens.surface}
      />
    </View>
  )
}

function TextArgRow({
  propKey,
  prop,
  value,
  onChange,
  disabled,
}: {
  propKey: string
  prop: SchemaProperty
  value: unknown
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const numeric = prop.type === `number` || prop.type === `integer`
  return (
    <View style={styles.fieldColumn}>
      <Text style={styles.pillLabel}>{fieldLabel(propKey, prop)}</Text>
      <TextInput
        value={value === undefined || value === null ? `` : String(value)}
        editable={!disabled}
        onChangeText={(text) =>
          onChange(propKey, coerceTextFieldValue(prop, text))
        }
        placeholder={prop.description ?? undefined}
        placeholderTextColor={tokens.text3}
        keyboardType={numeric ? `numeric` : `default`}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.fieldInput, disabled ? styles.controlDisabled : null]}
      />
    </View>
  )
}

function ArrayArgRow({
  propKey,
  prop,
  value,
  onChange,
  disabled,
}: {
  propKey: string
  prop: SchemaProperty
  value: unknown
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  // Hold the raw text while editing; finalizeSpawnArgs converts it to an array
  // at spawn (mirrors desktop SchemaForm).
  return (
    <View style={styles.fieldColumn}>
      <Text style={styles.pillLabel}>{fieldLabel(propKey, prop)}</Text>
      <TextInput
        value={stringArrayToDisplay(value)}
        editable={!disabled}
        onChangeText={(text) =>
          onChange(propKey, text === `` ? undefined : text)
        }
        placeholder={prop.description ?? `Comma-separated values`}
        placeholderTextColor={tokens.text3}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.fieldInput, disabled ? styles.controlDisabled : null]}
      />
      <Text style={styles.fieldHint}>Separate multiple values with commas</Text>
    </View>
  )
}

function JsonArgRow({
  propKey,
  prop,
  value,
  onChange,
  disabled,
}: {
  propKey: string
  prop: SchemaProperty
  value: unknown
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const display =
    typeof value === `string`
      ? value
      : value !== undefined
        ? JSON.stringify(value, null, 2)
        : ``
  return (
    <View style={styles.fieldColumn}>
      <Text style={styles.pillLabel}>{fieldLabel(propKey, prop)}</Text>
      <TextInput
        value={display}
        editable={!disabled}
        // Parse to an object when valid, else keep the raw text editable; the
        // server validates the final value (mirrors desktop SchemaForm).
        onChangeText={(text) => {
          if (text === ``) {
            onChange(propKey, undefined)
            return
          }
          try {
            onChange(propKey, JSON.parse(text))
          } catch {
            onChange(propKey, text)
          }
        }}
        placeholder="JSON value"
        placeholderTextColor={tokens.text3}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.fieldInput,
          styles.jsonInput,
          disabled ? styles.controlDisabled : null,
        ]}
      />
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    group: {
      gap: spacing.xs,
    },
    pill: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pillPressed: {
      backgroundColor: tokens.bgHover,
    },
    pillLabel: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      fontWeight: `500`,
    },
    pillValue: {
      flex: 1,
      textAlign: `right`,
      color: tokens.text1,
      fontSize: fontSize.sm,
    },
    sheetScroll: {
      maxHeight: 360,
    },
    boolRow: {
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `space-between`,
      gap: spacing.md,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    boolText: {
      flex: 1,
      gap: 2,
    },
    fieldColumn: {
      gap: spacing.xs,
    },
    fieldHint: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    fieldInput: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      color: tokens.text1,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    jsonInput: {
      minHeight: 72,
      fontFamily: monoFontFamily,
      textAlignVertical: `top`,
    },
    controlDisabled: {
      opacity: 0.5,
    },
  })
}

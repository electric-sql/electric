import { DMMF } from '@prisma/generator-helper'

import {
  ExtendedDMMFField,
  ExtendedDMMFFieldClass,
} from './extendedDMMFField/extendedDMMFField'
import { FormattedNames } from './formattedNames'
import {
  IMPORT_STATEMENT_REGEX,
  IMPORT_STATEMENT_REGEX_PATTERN,
} from '../constants'
import { GeneratorConfig } from '../schemas'

/////////////////////////////////////////////////
// TYPES  INTERFACE
/////////////////////////////////////////////////

export class ExtendedDMMFModel extends FormattedNames implements DMMF.Model {
  readonly generatorConfig: GeneratorConfig
  readonly name: DMMF.Model['name']
  readonly dbName: DMMF.Model['dbName']
  readonly fields: ExtendedDMMFField[]
  readonly uniqueFields: DMMF.Model['uniqueFields']
  readonly uniqueIndexes: DMMF.Model['uniqueIndexes']
  readonly documentation?: DMMF.Model['documentation']
  readonly primaryKey: DMMF.Model['primaryKey']
  readonly scalarFields: ExtendedDMMFField[]
  readonly relationFields: ExtendedDMMFField[]
  readonly filterdRelationFields: ExtendedDMMFField[]
  readonly enumFields: ExtendedDMMFField[]
  readonly hasRelationFields: boolean
  readonly hasRequiredJsonFields: boolean
  readonly hasOptionalJsonFields: boolean
  readonly hasOmitFields: boolean
  readonly hasDecimalFields: boolean
  readonly hasOptionalDefaultFields: boolean
  readonly imports: Set<string>
  readonly customImports: Set<string>
  readonly errorLocation: string
  readonly clearedDocumentation?: string
  readonly optionalJsonFields: ExtendedDMMFField[]
  readonly optionalJsonFieldUnion: string
  readonly writeOptionalDefaultValuesTypes: boolean
  readonly writeRelationValueTypes: boolean
  readonly writeOptionalDefaultsRelationValueTypes: boolean
  readonly writePartialTypes: boolean
  readonly writePartialRelationValueTypes: boolean

  constructor(generatorConfig: GeneratorConfig, model: DMMF.Model) {
    super(model.name)
    this.generatorConfig = generatorConfig
    this.name = model.name
    this.dbName = model.dbName
    this.fields = this._getExtendedFields(model)
    this.uniqueFields = model.uniqueFields
    this.uniqueIndexes = model.uniqueIndexes
    this.documentation = model.documentation
    this.primaryKey = model.primaryKey
    this.scalarFields = this._setScalarFields()
    this.relationFields = this._setRelationFields()
    this.filterdRelationFields = this._setFilteredRelationFields()
    this.enumFields = this._setEnumfields()
    this.hasRelationFields = this._setHasRelationFields()
    this.hasRequiredJsonFields = this._setHasRequiredJsonFields()
    this.hasOptionalJsonFields = this._setHasOptionalJsonFields()
    this.hasDecimalFields = this._setHasDecimalFields()
    this.hasOptionalDefaultFields = this._setHasOptionalDefaultFields()
    this.hasOmitFields = this._setHasOmitFields()
    this.errorLocation = this._setErrorLocation()

    const docsContent = this._getDocumentationContent()

    this.imports = docsContent.imports
    this.customImports = docsContent.customImports
    this.clearedDocumentation = docsContent?.documentation

    this.optionalJsonFields = this._setOptionalJsonFields()
    this.optionalJsonFieldUnion = this._setOptionalJsonFieldUnion()
    this.writeOptionalDefaultValuesTypes =
      this._setWriteOptionalDefaultValuesTypes()
    this.writeRelationValueTypes = this._setWriteRelationValueTypes()
    this.writeOptionalDefaultsRelationValueTypes =
      this._setWriteOptionalDefaultsRelationValueTypes()
    this.writePartialTypes = this._setWritePartialTypes()
    this.writePartialRelationValueTypes = this._writePartialRelationValueTypes()
  }

  private _setErrorLocation() {
    return `[Error Location]: Model: '${this.name}'.`
  }

  private _getExtendedFields(model: DMMF.Model) {
    return model.fields.map(
      (field) =>
        new ExtendedDMMFFieldClass(field, this.generatorConfig, this.name)
    )
  }

  private _setScalarFields() {
    return this.fields.filter((field) => field.kind === 'scalar')
  }

  private _setRelationFields() {
    return this.fields.filter((field) => field.kind === 'object')
  }

  // filterd relation fields are relation fields that are not self referencing
  // these are used to create the relation imports in the model
  private _setFilteredRelationFields() {
    return this.relationFields.filter(
      (field) => !field.type.includes(this.name)
    )
  }

  private _setHasRequiredJsonFields() {
    return this.fields.some((field) => field.isJsonType && field.isRequired)
  }

  private _setHasOptionalJsonFields() {
    return this.fields.some((field) => field.isJsonType && !field.isRequired)
  }

  private _setEnumfields() {
    return this.fields.filter((field) => field.kind === 'enum')
  }

  private _setHasRelationFields() {
    return this.relationFields.length > 0
  }

  private _setHasOmitFields() {
    return this.fields.some((field) => field.isOmitField())
  }

  private _setWriteOptionalDefaultValuesTypes() {
    return (
      this.hasOptionalDefaultFields &&
      this.generatorConfig.createOptionalDefaultValuesTypes
    )
  }

  private _setWritePartialTypes() {
    return this.generatorConfig.createPartialTypes
  }

  private _setWriteRelationValueTypes() {
    return (
      this.hasRelationFields && this.generatorConfig.createRelationValuesTypes
    )
  }

  private _setWriteOptionalDefaultsRelationValueTypes() {
    return this.writeRelationValueTypes && this.writeOptionalDefaultValuesTypes
  }

  private _writePartialRelationValueTypes() {
    return this.writeRelationValueTypes && this.writePartialTypes
  }

  private _setHasOptionalDefaultFields() {
    return this.fields.some((field) => field.isOptionalDefaultField)
  }

  private _setHasDecimalFields() {
    return this.fields.some((field) => field.isDecimalType)
  }

  private _setOptionalJsonFields() {
    return this.fields.filter((field) => field.isJsonType && !field.isRequired)
  }

  private _setOptionalJsonFieldUnion() {
    return this.optionalJsonFields.map((field) => `"${field.name}"`).join(' | ')
  }

  private _getDocumentationContent() {
    const zodDirectives = this._extractZodDirectives()
    const automaticImports = this._getAutomaticImports()

    if (!zodDirectives)
      return {
        imports: new Set(automaticImports),
        customImports: new Set([]),
      }

    return {
      imports: new Set([...zodDirectives.customImports, ...automaticImports]),
      documentation: zodDirectives.clearedDocumentation,
      customImports: new Set(zodDirectives.customImports),
    }
  }

  /**
   * extracts import statements  from the model's documentation and removes them from the documentation.
   * @returns array of import statements from the model's documentation and
   * a string of the documentation with the import statements removed.
   */
  private _extractZodDirectives() {
    if (!this.documentation) return

    const importStatements = this.documentation?.match(
      IMPORT_STATEMENT_REGEX_PATTERN
    )

    if (!importStatements) {
      return {
        customImports: [],
        clearedDocumentation: this.documentation,
      }
    }

    const type = importStatements.groups?.['type']

    if (type !== 'import') {
      throw new Error(
        `[@zod generator error]: '${type}' is not a valid validator key. ${this.errorLocation}`
      )
    }

    const importsList = importStatements.groups?.['imports']
      ?.split(/(?<="),/g) // split at `"` that is followed by a `,`
      .map((statement) => statement.trim())

    if (!importsList) {
      return {
        customImports: [],
        clearedDocumentation: this.documentation,
      }
    }

    return {
      customImports: importsList
        .map((statement) =>
          statement
            .match(IMPORT_STATEMENT_REGEX)
            ?.groups?.['statement'].replace(/["']/g, "'")
        )
        .filter(
          (statement): statement is string => typeof statement === 'string'
        ),
      clearedDocumentation: this.documentation
        .replace(IMPORT_STATEMENT_REGEX_PATTERN, '')
        .trim(),
    }
  }

  /**
   * Checks for certain field types and conditions and adds the necessary import statements to the model's imports.
   * @returns array of import statements that are automatically added to the model's imports.
   */
  private _getAutomaticImports() {
    const statements: string[] = []

    const { inputTypePath } = this.generatorConfig

    if (this.hasOptionalJsonFields) {
      statements.push(
        `import { NullableJsonValue } from "../${inputTypePath}/NullableJsonValue"`
      )
    }

    if (this.hasRequiredJsonFields) {
      statements.push(
        `import { InputJsonValue } from "../${inputTypePath}/InputJsonValue"`
      )
    }

    if (this.hasDecimalFields) {
      statements.push(
        `import { DecimalJSLikeSchema } from "../${inputTypePath}/DecimalJsLikeSchema"`,
        `import { isValidDecimalInput } from "../${inputTypePath}/isValidDecimalInput"`
      )
    }

    this.enumFields.forEach((field) => {
      statements.push(
        `import { ${field.type}Schema } from '../${inputTypePath}/${field.type}Schema'`
      )
    })

    return statements
  }
}

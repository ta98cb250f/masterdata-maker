// 編集操作（パッチ・コマンド・入力値の変換・元に戻す履歴）の公開 API
export { EDIT_MESSAGE_CODES, EditCode } from './codes';
export type { EditCodeValue } from './codes';

export {
  PatchError,
  applyPatch,
  applyPatches,
  cellDataEquals,
  commonVersion,
  fromCellData,
  fromRecordData,
  fromTableData,
  isCellDataEmpty,
  patchCommonPart,
  patchTable,
  recordIndex,
  tableListVersion,
  tableVersion,
  toCellData,
  toRecordData,
  toTableData,
} from './patch';
export type { CellChange, CellData, IndexedRecord, Patch, PatchOp, RecordData, TableData } from './patch';

export { TxBuilder, emptyResult } from './transaction';
export type { CommandResult, EditFailure, FocusHint, Transaction } from './transaction';

export {
  cellEditText,
  cellFormula,
  convertValue,
  formatValueText,
  formatWithOffset,
  inputContext,
  keepSameInstant,
  parseCellInput,
  projectTimeZone,
} from './input';
export type { ConvertResult, FieldTypeInfo, InputContext, InputError, InputMode, InputParams, ParsedInput } from './input';

export { formatEditFailure, formatInputError, formatInputHint } from './messages';
export type { FailureLocation } from './messages';

export { DEFAULT_COLUMN_WIDTH, isValidIdentifier } from './helpers';
export type { CellTarget, TableCellTarget } from './helpers';

export { EditSession } from './session';
export type { ApplyResult, EditEvent, EditListener, EditSessionOptions, SaveFile, SavePlan, SaveTarget } from './session';

export { clearCells, enterInput, replaceCells, setCellColor, setCellComment } from './commands/cells';
export type { CellColorArgs, CellsArgs, CommentArgs, EnterInputArgs, ReplaceArgs, ReplaceResult } from './commands/cells';

export { copyCells, fillDown, fillRight, pasteCells } from './commands/clipboard';
export type { ClipSource, ClipboardData, CopyArgs, CopyDirectionArgs, EffectiveValueFn, PasteArgs } from './commands/clipboard';

export { fillCells, fillSeriesCells } from './commands/fill';
export type { FillArgs, FillDirection, SeriesArgs } from './commands/fill';

export { applySortOrder, deleteRows, duplicateRows, insertRows, moveRows } from './commands/rows';
export type { ApplySortArgs, InsertRowsArgs, MoveRowsArgs, RowsArgs } from './commands/rows';

export {
  changeColumnType,
  checkColumnTypeChange,
  deleteColumns,
  insertColumn,
  moveColumns,
  renameColumn,
  setColumnWidth,
  setColumnsHidden,
  setFrozenColumns,
  updateColumn,
  validateColumnName,
} from './commands/columns';
export type {
  ChangeTypeArgs,
  ColumnPosition,
  ColumnWidthArgs,
  ColumnsArgs,
  FrozenColumnsArgs,
  HiddenColumnsArgs,
  InsertColumnArgs,
  MoveColumnsArgs,
  RenameColumnArgs,
  TypeChangeIssue,
  UpdateColumnArgs,
} from './commands/columns';

export {
  createTable,
  deleteTable,
  duplicateTable,
  findTableReferences,
  renameBaseField,
  renameEnum,
  renameTable,
  setBaseFields,
  setColors,
  setEnums,
  setTableDisplayName,
  suggestTableName,
  validateTableName,
} from './commands/tables';
export type { CreateTableArgs, DuplicateTableArgs, RenameTableArgs, TableDisplayNameArgs, TableReference } from './commands/tables';

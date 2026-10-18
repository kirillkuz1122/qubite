/**
 * Протокол синхронизации — зеркало Rust-crate `qubite-sync`.
 * Совпадение формата проверяется тестом на общих образцах JSON
 * (`crates/qubite-sync/fixtures/*.json`).
 */

/** Поля модуля (у элемента Входящих — текст, ссылка, источник, статус…). */
export type Fields = Record<string, unknown>;

export type OpKind =
  | { kind: 'create'; object_type: string; title: string; fields?: Fields }
  | { kind: 'set_title'; title: string }
  | { kind: 'delete' }
  | { kind: 'restore' }
  /** Изменить поля модуля — только меняющиеся. */
  | { kind: 'patch'; fields: Fields };

export type Operation = {
  op_id: string;
  object_id: string;
  /** Версия, от которой сделана правка. У `create` отсутствует. */
  base_revision?: number;
} & OpKind;

export interface PushRequest {
  device_id: string;
  ops: Operation[];
}

export interface ObjectSnapshot {
  id: string;
  object_type: string;
  title: string;
  revision: number;
  deleted: boolean;
  updated_at_ms: number;
  /** Поля модуля, если у типа они есть. */
  fields?: Fields;
}

/** `forbidden` — нет права менять объекты этого модуля. */
export type RejectReason = 'not_found' | 'invalid' | 'forbidden';

export type OpResult =
  | { status: 'applied'; op_id: string; revision: number }
  | { status: 'conflict'; op_id: string; current: ObjectSnapshot }
  | { status: 'rejected'; op_id: string; reason: RejectReason; message: string };

export interface PushResponse {
  results: OpResult[];
}

export interface PullResponse {
  changes: ObjectSnapshot[];
  cursor: number;
  has_more: boolean;
}

export const MAX_OPS_PER_PUSH = 500;

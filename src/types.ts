import type { Ownership } from './contracts.ts';

/** The storage subset used by the core; supplied by the owning runtime. */
export interface D1Result<T = unknown> { results?: T[]; success?: boolean; }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface Target {
  name: string;
  schedule: string;
  binding: string;
  entrypoint: string;
  active: boolean;
  ownership: Ownership;
  continuationSchedule?: string;
}
export interface ScheduledPayload {
  scheduledTime: number;
  cron: string;
  target: string;
  drainOnly?: boolean;
  runId?: string;
  attempt?: number;
  fencingToken?: number;
  contractVersion?: number;
}
export interface RunResult {
  ok: boolean;
  rid: string;
  error?: string;
  durationMs?: number;
  outcome?: 'completed' | 'failed' | 'uncertain' | 'accepted';
  completedItems?: number;
  pendingItems?: number;
}

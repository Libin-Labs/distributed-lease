export interface LeaseRecord {
  owner: string;
  fencingToken: number;
  expiresAt: number;
}

export interface LeaseAdapter {
  acquire(
    key: string,
    owner: string,
    ttlMs: number,
  ): PromiseLike<LeaseRecord | null> | LeaseRecord | null;
  renew(
    key: string,
    owner: string,
    fencingToken: number,
    ttlMs: number,
  ): PromiseLike<LeaseRecord | null> | LeaseRecord | null;
  release(key: string, owner: string, fencingToken: number): PromiseLike<boolean> | boolean;
}

export interface LeaseManagerOptions {
  ownerId: string;
}

export interface LeaseHandle {
  readonly key: string;
  readonly owner: string;
  readonly fencingToken: number;
  readonly expiresAt: number;
  readonly active: boolean;
  renew(ttlMs: number): Promise<boolean>;
  release(): Promise<boolean>;
}

export interface DistributedLeaseManager {
  acquire(key: string, ttlMs: number): Promise<LeaseHandle | null>;
}

export class LeaseError extends Error {
  constructor(
    readonly code: 'invalid' | 'adapter',
    message: string,
  ) {
    super(message);
    this.name = 'LeaseError';
  }
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length < 1 || key.length > 256)
    throw new LeaseError('invalid', 'key must contain 1..256 characters.');
}

function validateTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1)
    throw new LeaseError('invalid', 'ttlMs must be a positive safe integer.');
}

function validateRecord(record: LeaseRecord | null, owner: string): void {
  if (
    record !== null &&
    (record === undefined ||
      typeof record !== 'object' ||
      record.owner !== owner ||
      !Number.isSafeInteger(record.fencingToken) ||
      record.fencingToken < 1 ||
      !Number.isSafeInteger(record.expiresAt))
  )
    throw new LeaseError('adapter', 'Adapter returned an invalid lease record.');
}

export function createDistributedLeaseManager(
  adapter: LeaseAdapter,
  options: LeaseManagerOptions,
): DistributedLeaseManager {
  if (
    adapter === null ||
    typeof adapter !== 'object' ||
    typeof adapter.acquire !== 'function' ||
    typeof adapter.renew !== 'function' ||
    typeof adapter.release !== 'function'
  )
    throw new LeaseError('invalid', 'adapter must implement acquire, renew, and release.');
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
  )
    throw new LeaseError('invalid', 'Options must be a plain object.');
  for (const key of Reflect.ownKeys(options)) {
    const descriptor =
      typeof key === 'string' ? Object.getOwnPropertyDescriptor(options, key) : undefined;
    if (key !== 'ownerId' || !descriptor?.enumerable || !('value' in descriptor))
      throw new LeaseError('invalid', 'Options contain an unsupported field or accessor.');
  }
  const owner = options.ownerId;
  if (typeof owner !== 'string' || owner.length < 1 || owner.length > 256)
    throw new LeaseError('invalid', 'ownerId must contain 1..256 characters.');
  return {
    async acquire(key, ttlMs) {
      validateKey(key);
      validateTtl(ttlMs);
      const record = await adapter.acquire(key, owner, ttlMs);
      validateRecord(record, owner);
      if (record === null) return null;
      let active = true;
      let expiresAt = record.expiresAt;
      return {
        key,
        owner,
        fencingToken: record.fencingToken,
        get expiresAt() {
          return expiresAt;
        },
        get active() {
          return active;
        },
        async renew(nextTtlMs) {
          validateTtl(nextTtlMs);
          if (!active) return false;
          let next: LeaseRecord | null;
          try {
            next = await adapter.renew(key, owner, record.fencingToken, nextTtlMs);
          } catch (error) {
            active = false;
            throw error;
          }
          validateRecord(next, owner);
          if (next === null || next.fencingToken !== record.fencingToken) {
            active = false;
            return false;
          }
          if (active) expiresAt = next.expiresAt;
          return active;
        },
        async release() {
          if (!active) return false;
          active = false;
          const released = await adapter.release(key, owner, record.fencingToken);
          if (typeof released !== 'boolean')
            throw new LeaseError('adapter', 'Adapter release must return a boolean.');
          return released;
        },
      };
    },
  };
}

export function createMemoryLeaseAdapter(clock: () => number = Date.now): LeaseAdapter {
  if (typeof clock !== 'function') throw new LeaseError('invalid', 'clock must be a function.');
  const current = new Map<string, LeaseRecord>();
  const counters = new Map<string, number>();
  const now = (): number => {
    const value = clock();
    if (!Number.isSafeInteger(value))
      throw new LeaseError('adapter', 'clock must return a safe integer.');
    return value;
  };
  return {
    acquire(key, owner, ttlMs) {
      const time = now();
      const record = current.get(key);
      if (record && record.expiresAt > time) return null;
      const token = (counters.get(key) ?? 0) + 1;
      if (!Number.isSafeInteger(token))
        throw new LeaseError('adapter', 'Fencing token counter exceeded safe integer bounds.');
      const expiresAt = time + ttlMs;
      if (!Number.isSafeInteger(expiresAt))
        throw new LeaseError('adapter', 'Lease expiration exceeds safe integer bounds.');
      counters.set(key, token);
      const next = { owner, fencingToken: token, expiresAt };
      current.set(key, next);
      return { ...next };
    },
    renew(key, owner, fencingToken, ttlMs) {
      const time = now();
      const record = current.get(key);
      if (
        !record ||
        record.owner !== owner ||
        record.fencingToken !== fencingToken ||
        record.expiresAt <= time
      )
        return null;
      const expiresAt = time + ttlMs;
      if (!Number.isSafeInteger(expiresAt))
        throw new LeaseError('adapter', 'Lease expiration exceeds safe integer bounds.');
      const next = { ...record, expiresAt };
      current.set(key, next);
      return { ...next };
    },
    release(key, owner, fencingToken) {
      const record = current.get(key);
      if (!record || record.owner !== owner || record.fencingToken !== fencingToken) return false;
      current.delete(key);
      return true;
    },
  };
}

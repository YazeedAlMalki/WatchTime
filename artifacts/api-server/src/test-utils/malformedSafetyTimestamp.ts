import { vi } from "vitest";

function mapQueryRows(
  query: any,
  mapRows: (rows: any[]) => any[],
): any {
  let proxy: any;
  proxy = new Proxy(query, {
    get(target, property) {
      if (property === "then") {
        const then = Reflect.get(target, property, target);
        return (onFulfilled: (rows: any[]) => unknown, onRejected: (error: unknown) => unknown) =>
          then.call(
            target,
            (rows: any[]) => onFulfilled(mapRows(rows)),
            onRejected,
          );
      }

      const member = Reflect.get(target, property, target);
      if (typeof member !== "function") return member;

      return (...args: any[]) => {
        const next = Reflect.apply(member, target, args);
        if (next === target) return proxy;
        if (next && typeof next === "object" && typeof (next as any).then === "function") {
          return mapQueryRows(next, mapRows);
        }
        return next;
      };
    },
  });
  return proxy;
}

/**
 * Inject a malformed timestamp into a selected safety-record query result.
 * The database row itself remains valid, avoiding PostgreSQL timestamp decoding.
 */
export function mockMalformedSafetyTimestamp(
  database: object,
  recordId: number,
  timestamp: Date | string,
): () => void {
  return mockMalformedSafetyTimestamps(database, new Map([[recordId, timestamp]]));
}

export function mockMalformedSafetyTimestampDuplicate(
  database: object,
  recordId: number,
  timestamp: Date | string,
  duplicate: { label: string; url: string },
): () => void {
  const db = database as any;
  const originalSelect = db.select.bind(db);
  const selectSpy = vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
    const query = originalSelect(...args);
    if (!args[0] || !Object.prototype.hasOwnProperty.call(args[0], "rawUpdatedAt")) {
      return query;
    }

    return mapQueryRows(query, (rows) => {
      const source = rows.find((row) => row.id === recordId);
      if (!source) return rows;

      return [
        ...rows,
        {
          ...source,
          id: -Math.abs(recordId),
          updatedAt: timestamp,
          rawUpdatedAt: timestamp,
          url: duplicate.url,
          items: source.items.map((item: any) =>
            item.category === "MPAA" ? { ...item, label: duplicate.label } : item,
          ),
        },
      ];
    });
  });

  return () => selectSpy.mockRestore();
}

export function mockSafetyRecordQueryOrder(
  database: object,
  order: "forward" | "reverse",
  duplicate?: { sourceRecordId: number; duplicateRecordId: number },
): () => void {
  const db = database as any;
  const originalSelect = db.select.bind(db);
  const selectSpy = vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
    const query = originalSelect(...args);
    if (!args[0] || !Object.prototype.hasOwnProperty.call(args[0], "rawUpdatedAt")) {
      return query;
    }

    return mapQueryRows(query, (rows) => {
      const sourceRecord = duplicate
        ? rows.find((row) => row.id === duplicate.sourceRecordId)
        : undefined;
      const rowsToOrder = sourceRecord
        ? [...rows, { ...sourceRecord, id: duplicate!.duplicateRecordId }]
        : rows;
      return order === "reverse" ? [...rowsToOrder].reverse() : rowsToOrder;
    });
  });

  return () => selectSpy.mockRestore();
}

export function mockMalformedSafetyTimestamps(
  database: object,
  timestamps: ReadonlyMap<number, Date | string>,
): () => void {
  const db = database as any;
  const originalSelect = db.select.bind(db);
  const selectSpy = vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
    const query = originalSelect(...args);
    if (!args[0] || !Object.prototype.hasOwnProperty.call(args[0], "rawUpdatedAt")) {
      return query;
    }

    return mapQueryRows(query, (rows) => rows.map((row) =>
      timestamps.has(row.id)
        ? { ...row, updatedAt: timestamps.get(row.id), rawUpdatedAt: timestamps.get(row.id) }
        : row,
    ));
  });

  return () => selectSpy.mockRestore();
}
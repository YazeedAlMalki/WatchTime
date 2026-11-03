import type { SafetyClassificationCorrection, SafetyItem } from "@workspace/db";

function matchesSource(item: SafetyItem, correction: SafetyClassificationCorrection) {
  return item.category === correction.sourceCategory && item.label === correction.sourceLabel;
}

export function applySafetyClassificationCorrections(
  providerItems: SafetyItem[],
  corrections: SafetyClassificationCorrection[] | null | undefined,
): SafetyItem[] {
  if (!corrections?.length) return providerItems;

  const usedIndexes = new Set<number>();
  const correctionIndexes = new Map<SafetyClassificationCorrection, number>();
  for (const correction of corrections) {
    const matches = providerItems.flatMap((item, index) =>
      matchesSource(item, correction) ? [index] : [],
    );
    const targetIndex = matches[correction.sourceOccurrence];
    if (targetIndex === undefined || usedIndexes.has(targetIndex)) continue;
    usedIndexes.add(targetIndex);
    correctionIndexes.set(correction, targetIndex);
  }

  return providerItems.map((item, index) => {
    const correction = corrections.find((candidate) => correctionIndexes.get(candidate) === index);
    return correction ? { ...item, category: correction.category } : item;
  });
}

export function findSafetyClassificationCorrection(
  corrections: SafetyClassificationCorrection[] | null | undefined,
  category: string,
  label: string,
) {
  return corrections?.find((correction) =>
    correction.category === category && correction.sourceLabel === label,
  ) ?? null;
}

export function recoverLegacySafetyClassificationCorrection(
  items: SafetyItem[],
  auditRows: Array<{
    adminId: string;
    createdAt: Date;
    details: unknown;
  }> | null | undefined,
) {
  if (!auditRows?.length) return null;

  const latestAuditByIndex = new Map<number, (typeof auditRows)[number]>();
  for (const audit of auditRows) {
    if (!audit.details || typeof audit.details !== "object") continue;
    const sourceIndex = (audit.details as Record<string, unknown>).classificationIndex;
    if (
      Number.isInteger(sourceIndex) &&
      (sourceIndex as number) >= 0 &&
      (sourceIndex as number) < items.length &&
      !latestAuditByIndex.has(sourceIndex as number)
    ) {
      latestAuditByIndex.set(sourceIndex as number, audit);
    }
  }

  const active = [...latestAuditByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([sourceIndex, audit]) => {
      const details = audit.details as Record<string, unknown>;
      const item = items[sourceIndex];
      const category = details.category;
      if (typeof category !== "string" || item.category !== category) return [];
      return [{
        sourceIndex,
        audit,
        item,
        category,
        sourceCategory:
          typeof details.previousCategory === "string" ? details.previousCategory : null,
        sourceLabel: typeof details.sourceLabel === "string" ? details.sourceLabel : item.label,
      }];
    });
  if (active.length === 0) return null;

  const sourceCategoryByIndex = new Map(
    active.map((correction) => [correction.sourceIndex, correction.sourceCategory]),
  );
  const classificationCorrections = active.map((correction) => {
    const sourceOccurrence = items
      .slice(0, correction.sourceIndex)
      .filter((candidate, index) => {
        const sourceCategory = sourceCategoryByIndex.has(index)
          ? sourceCategoryByIndex.get(index)
          : candidate.category;
        return sourceCategory === correction.sourceCategory &&
          candidate.label === correction.sourceLabel;
      }).length;
    const result: SafetyClassificationCorrection = {
      sourceIndex: correction.sourceIndex,
      sourceCategory: correction.sourceCategory,
      sourceLabel: correction.sourceLabel,
      sourceOccurrence,
      category: correction.category,
      adminId: correction.audit.adminId,
      correctedAt: correction.audit.createdAt.toISOString(),
    };
    return result;
  });
  return { classificationCorrections };
}

export function MoodBar({
  label,
  value,
  target,
  testId,
}: {
  label: string;
  value: number;
  target?: number;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-foreground/90">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="relative h-1.5 rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary/80" style={{ width: `${value}%` }} />
        {target !== undefined && (
          <span
            aria-hidden
            className="absolute -top-1 h-3.5 w-0.5 rounded bg-foreground"
            style={{ insetInlineStart: `${target}%` }}
          />
        )}
      </div>
    </div>
  );
}

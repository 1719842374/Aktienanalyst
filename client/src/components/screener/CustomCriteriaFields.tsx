import type { CriterionDraft } from "@shared/custom-screen";

export function CustomCriteriaFields({
  draft,
  onField,
  idPrefix,
  testId,
  marketCapUnit,
}: {
  draft: CriterionDraft;
  onField: (key: keyof CriterionDraft, value: string) => void;
  idPrefix: string;
  testId: string;
  marketCapUnit: "USD" | "Mio. USD";
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 min-w-0" data-testid={testId}>
      <Field label={`MCap min, ${marketCapUnit}`} value={draft.marketCapMin} onChange={(value) => onField("marketCapMin", value)} testId={`${idPrefix}-mcap-min`} />
      <Field label={`MCap max, ${marketCapUnit}`} value={draft.marketCapMax} onChange={(value) => onField("marketCapMax", value)} testId={`${idPrefix}-mcap-max`} />
      <Field label="Industrie enthält" value={draft.industry} onChange={(value) => onField("industry", value)} testId={`${idPrefix}-industry`} />
      <Field label="Land enthält" value={draft.country} onChange={(value) => onField("country", value)} testId={`${idPrefix}-country`} />
      <Field label="ROIC min" value={draft.roicMin} onChange={(value) => onField("roicMin", value)} testId={`${idPrefix}-roic`} />
      <Field label="Forward P/E max" value={draft.forwardPeMax} onChange={(value) => onField("forwardPeMax", value)} testId={`${idPrefix}-fwd-pe`} />
    </div>
  );
}

function Field({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  return (
    <label className="min-w-0 text-[10px] text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-9 w-full min-w-0 rounded-md border border-border bg-muted/30 px-2 text-xs text-foreground sm:h-7"
        data-testid={testId}
      />
    </label>
  );
}

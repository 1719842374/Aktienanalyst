import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useLocale } from "@/lib/locale";
import type { BalanceFlag } from "@shared/balance-screen";

interface ScreenBody {
  rowCount: number;
  flags: BalanceFlag[];
  note: string;
  error?: string;
}

export default function BalanceScreenPage() {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);

  const screen = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/balance-screen", { csv: text });
      const body = await res.json() as ScreenBody;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => setError(null),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <main className="max-w-3xl mx-auto p-3 sm:p-6 space-y-4" data-testid="balance-screen">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("balance.title")}</h1>
        <button
          type="button"
          className="text-[11px] underline text-muted-foreground"
          onClick={() => navigate("/")}
          data-testid="balance-back"
        >
          {t("balance.back")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t("balance.lead")}</p>
      <label className="block text-[11px] text-muted-foreground">
        {t("balance.file")}
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="mt-1 block w-full text-xs"
          data-testid="balance-file"
          onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setCsv(typeof reader.result === "string" ? reader.result : "");
            reader.readAsText(file);
          }}
        />
      </label>
      <label className="block text-[11px] text-muted-foreground">
        {t("balance.paste")}
        <textarea
          value={csv}
          onChange={event => setCsv(event.target.value)}
          rows={8}
          className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs font-mono"
          data-testid="balance-csv"
        />
      </label>
      <button
        type="button"
        className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
        disabled={screen.isPending || !csv.trim()}
        data-testid="balance-run"
        onClick={() => screen.mutate(csv)}
      >
        {t("balance.run")}
      </button>
      {error && <p className="text-xs text-amber-600 dark:text-amber-400 break-words" data-testid="balance-error">{error}</p>}
      {!screen.data && !error && <p className="text-xs text-muted-foreground">{t("balance.empty")}</p>}
      {screen.data && (
        <div className="space-y-2" data-testid="balance-result">
          <p className="text-[11px] text-muted-foreground">{t("balance.rows")}: {screen.data.rowCount}. {screen.data.note}</p>
          <ul className="space-y-2">
            {screen.data.flags.map(item => (
              <li key={item.id} className="rounded-md border border-border p-2" data-testid={`balance-flag-${item.id}`}>
                <div className="text-xs font-medium">{item.title}</div>
                <div className="text-[11px] text-muted-foreground break-words">
                  {item.active == null ? item.detail : item.active ? `Flag — ${item.detail}` : item.detail}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

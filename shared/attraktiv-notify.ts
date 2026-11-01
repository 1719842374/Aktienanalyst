/**
 * ATTRAKTIV-Mail (WORK_HYPECYCLE_EMAIL_SUPABASE §2).
 * Der Code bereitet Payload und Schema vor. Versand bleibt aus, bis Philip
 * Flag, Provider und Supabase setzt. Es gibt keinen Adapter (Entscheidung 01.11.).
 * Dieses Modul öffnet keine Verbindung und liest keine Secrets in den Payload.
 */

export const ATTRAKTIV_EMAIL_FLAG = "ATTRAKTIV_EMAIL_ENABLED";

/** Von Philip in Supabase auszuführen. Wird hier nicht applied. */
export const ATTRAKTIV_EMAIL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text NOT NULL,
  ticker text NOT NULL,
  notify_on text[] DEFAULT ARRAY['ATTRAKTIV'],
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_scores (
  ticker text PRIMARY KEY,
  status text,
  score numeric,
  updated_at timestamptz DEFAULT now()
);
`.trim();

export interface AttraktivMail {
  to: string;
  ticker: string;
  status: string;
  score: number | null;
  reason: string;
  link: string | null;
}

export interface AttraktivEmailStatus {
  flag: boolean;
  send: false;
  reason: string;
  schemaReady: false;
}

export function attraktivEmailStatus(env: Record<string, string | undefined>): AttraktivEmailStatus {
  const flag = env[ATTRAKTIV_EMAIL_FLAG] === "true";
  const staysOff = "n/a — ATTRAKTIV-Mail bleibt aus, kein Versand-Adapter.";
  if (!flag) {
    return {
      flag: false,
      send: false,
      schemaReady: false,
      reason: `${staysOff} ATTRAKTIV_EMAIL_ENABLED ist nicht gesetzt. Tabellen, Service-Role und Mail-Provider legt Philip an. Dieser Pfad sendet nichts.`,
    };
  }
  return {
    flag,
    send: false,
    schemaReady: false,
    reason: `${staysOff} Flag ist an, aber es gibt keinen Versand-Adapter und kein Supabase-Schema in diesem Lauf. Philip schaltet Provider und Konto.`,
  };
}

export function buildAttraktivMail(input: {
  to: string | null;
  ticker: string | null;
  status: string | null;
  score: number | null;
  reason: string | null;
  link: string | null;
}): { mail: AttraktivMail | null; reason: string } {
  if (!input.to || !input.ticker || !input.status) {
    return { mail: null, reason: "n/a — Empfänger, Ticker oder Status fehlt" };
  }
  if (input.status !== "ATTRAKTIV") {
    return { mail: null, reason: `n/a — Status ist ${input.status}, Mail nur bei ATTRAKTIV` };
  }
  return {
    mail: {
      to: input.to,
      ticker: input.ticker,
      status: input.status,
      score: input.score != null && Number.isFinite(input.score) ? input.score : null,
      reason: input.reason?.trim() || "n/a — keine Begründung mitgeliefert",
      link: input.link,
    },
    reason: "Payload bereit, Versand aus",
  };
}

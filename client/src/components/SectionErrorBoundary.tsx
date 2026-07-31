import { Component, type ReactNode, type ErrorInfo } from "react";

// Per-section error boundary. Wrapping each Section*.tsx in this prevents a
// single component crash (e.g. reading .slice / .includes on an undefined
// field) from unmounting the entire dashboard and leaving the user with a
// blank dark screen. Instead, the offending section shows a compact inline
// error card and the other 16 sections keep rendering.
//
// This is defensive: the backend now returns schema-conforming shapes, but
// there is no reason to let a future field-rename regression take the whole
// app down again.

interface Props {
  sectionId: number | string;
  sectionLabel: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? String(err) };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // Keep the console signal so devs can still debug in production.
    console.error(`[Section ${this.props.sectionId} — ${this.props.sectionLabel}] crashed:`, err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 my-2">
        <div className="flex items-start gap-2">
          <div className="text-amber-500 text-lg leading-none">⚠</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-500">
              Sektion {this.props.sectionId} — {this.props.sectionLabel}: Renderfehler
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Diese Sektion konnte nicht dargestellt werden. Die anderen Sektionen sind unberührt.
            </div>
            <div className="text-[10px] font-mono text-muted-foreground/70 mt-2 break-all opacity-70">
              {this.state.message.slice(0, 240)}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

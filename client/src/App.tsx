import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Dashboard from "@/pages/Dashboard";
import BTCDashboard from "@/pages/BTCDashboard";
import GoldDashboard from "@/pages/GoldDashboard";
import RecessionDashboard from "@/pages/RecessionDashboard";
import ScreenerDashboard from "@/pages/ScreenerDashboard";
import Researcher from "@/pages/Researcher";
import Compare from "@/pages/Compare";
import PortfolioPage from "@/pages/PortfolioPage";
// CalibrationPage: interne Kalibrierungs-Diagnose (Sprint B3 Phase 4,
// tickets/SPRINT_B3_PHASE4_CALIBRATION_UI.md). Bewusst NICHT im Dashboard/
// in der Hauptnavigation verlinkt -- nur ueber die direkte Hash-Route
// /#/calibration erreichbar (siehe Route unten). Kein Endnutzer-Feature.
import CalibrationPage from "@/pages/CalibrationPage";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/btc" component={BTCDashboard} />
      <Route path="/gold" component={GoldDashboard} />
      <Route path="/recession" component={RecessionDashboard} />
      <Route path="/screener" component={ScreenerDashboard} />
      <Route path="/researcher" component={Researcher} />
      <Route path="/compare" component={Compare} />
      <Route path="/portfolio" component={PortfolioPage} />
      {/* /calibration: absichtlich NICHT in Dashboard.tsx/Sidebar verlinkt (siehe
          Import-Kommentar oben) -- Route existiert nur fuer direkten Aufruf. */}
      <Route path="/calibration" component={CalibrationPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

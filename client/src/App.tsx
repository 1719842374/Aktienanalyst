import { useSyncExternalStore } from "react";
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
import ValueChainDashboard from "@/pages/ValueChainDashboard";
import ThesisLabDashboard from "@/pages/ThesisLabDashboard";
import CalibrationPage from "@/pages/CalibrationPage";
import NotFound from "@/pages/not-found";

function subscribeToHash(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("hashchange", onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

/** Query may live in the hash (`#/lab?ticker=`) or in location.search after wouter navigate. */
function readHashOrSearch(): string {
  const hash = window.location.hash;
  const idx = hash.indexOf("?");
  if (idx >= 0) return hash.slice(idx);
  return window.location.search;
}

function useHashSearch() {
  return useSyncExternalStore(subscribeToHash, readHashOrSearch, () => "");
}

/**
 * useHashLocation includes `?query` in the path, so `/#/lab?ticker=` misses Route path="/lab".
 * Strip the query for matching and expose it via searchHook.
 */
function useHashLocationWithQuery() {
  const [loc, navigate] = useHashLocation();
  const path = loc.split("?")[0] || "/";
  return [path, navigate] as [string, typeof navigate];
}
Object.assign(useHashLocationWithQuery, { searchHook: useHashSearch });

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
      <Route path="/valuechain" component={ValueChainDashboard} />
      <Route path="/lab" component={ThesisLabDashboard} />
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
          <Router hook={useHashLocationWithQuery}>
            <AppRouter />
          </Router>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

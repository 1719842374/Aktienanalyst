import { useState, useRef, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { analyzeBTC } from "@/lib/btcAnalysis";
import { BTC_FALLBACK_DATA } from "@/lib/btcFallbackData";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { RechenWeg } from "@/components/RechenWeg";
import { formatCurrency, formatLargeNumber, formatPercent, getChangeColor } from "@/lib/formatters";
import { gbmMonteCarlo, type GBMMonteCarloResult } from "@/lib/calculations";
import { useLocation } from "wouter";
import {
  Sun, Moon, Bitcoin, TrendingUp, TrendingDown, Activity, Calculator,
  LineChart as LineChartIcon, Target, Scale, BarChart3, Dice6,
  Menu, X, ChevronRight, Gauge, Layers, ArrowLeft,
  CheckCircle2, XCircle, AlertTriangle, Eye, EyeOff,
  RefreshCw, Search, Sparkles,
} from "lucide-react";

// PLACEHOLDER - full content will be pushed via push_files
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import {
  collectBusinessSearchCorpus,
  filterBusinessSearchHits,
  type BusinessSearchHit,
} from "@/app/lib/businessSearchIndex";

export type BusinessSearchMode = "client" | "server";

type UseBusinessSearchOptions = {
  /** Debounce typing before filtering. Default 250ms. */
  debounceMs?: number;
  /**
   * Search backend mode.
   * - `client` (default): filter already-loaded dashboard caches (no network while typing)
   * - `server`: reserved for a future `/api/business/search` endpoint
   */
  mode?: BusinessSearchMode;
};

type UseBusinessSearchResult = {
  query: string;
  setQuery: (value: string) => void;
  debouncedQuery: string;
  results: BusinessSearchHit[];
  isSearching: boolean;
  mode: BusinessSearchMode;
};

/**
 * Business dashboard global search.
 * Client mode uses in-memory / session caches only — never hits the network on keystroke.
 */
export function useBusinessSearch(options: UseBusinessSearchOptions = {}): UseBusinessSearchResult {
  const { debounceMs = 250, mode = "client" } = options;
  const { user } = useAuth();
  const businessId = user?.businessId ?? null;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => window.clearTimeout(id);
  }, [query, debounceMs]);

  const corpus = useMemo(() => {
    if (mode !== "client") return [];
    // Rebuild corpus when the debounced query changes so freshly visited pages
    // (staff/tables/tips) are included without polling.
    void debouncedQuery;
    return collectBusinessSearchCorpus(businessId);
  }, [mode, businessId, debouncedQuery]);

  const results = useMemo(() => {
    if (mode === "server") {
      // Future: call backend search endpoint with debouncedQuery.
      return [];
    }
    return filterBusinessSearchHits(corpus, debouncedQuery);
  }, [mode, corpus, debouncedQuery]);

  const isSearching = query.trim() !== debouncedQuery.trim();

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    isSearching,
    mode,
  };
}

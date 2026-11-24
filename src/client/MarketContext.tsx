import React, { createContext, useContext, useState } from 'react';
import { MARKETS, type MarketCode, type MarketConfig } from '../shared/markets.ts';

interface MarketContextValue {
  marketCode: MarketCode;
  market: MarketConfig;
  setMarketCode: (code: MarketCode) => void;
}

const STORAGE_KEY = 'coverpulse_market_code';

function readInitialMarket(): MarketCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in MARKETS) {
      return saved as MarketCode;
    }
  } catch {
    // ignore storage restriction
  }
  return 'AU';
}

const MarketContext = createContext<MarketContextValue>({
  marketCode: 'AU',
  market: MARKETS.AU,
  setMarketCode: () => {},
});

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [marketCode, setMarketCodeState] = useState<MarketCode>(readInitialMarket);

  function setMarketCode(code: MarketCode) {
    setMarketCodeState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // ignore storage restriction
    }
  }

  return (
    <MarketContext.Provider
      value={{
        marketCode,
        market: MARKETS[marketCode],
        setMarketCode,
      }}
    >
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket(): MarketContextValue {
  return useContext(MarketContext);
}

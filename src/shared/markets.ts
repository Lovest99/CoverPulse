export type MarketCode = 'AU' | 'US' | 'UK' | 'CA';

export interface MarketConfig {
  code: MarketCode;
  name: string;
  shortName: string;
  launchBadge?: string;
  currencyCode: string;
  currencySymbol: string;
  /** Indicative multiplier from base AUD amounts for regional display */
  fxFromAud: number;
  taxLabel: string;
  businessIdLabel: string;
  businessIdPlaceholder: string;
  privacyFramework: string;
  regulatoryBody: string;
  clinicalCheckExample: string;
  clearanceCheckExample: string;
  phoneCountryCode: string;
  phonePlaceholder: string;
  suburbLabel: string;
  suburbPlaceholder: string;
  regionLabel: string;
  regionPlaceholder: string;
  regions: string[];
  postalLabel: string;
  postalPlaceholder: string;
  defaultTimezone: string;
  timezones: string[];
  sectors: [string, string, string];
  providerDensityNote: string;
}

export const MARKETS: Record<MarketCode, MarketConfig> = {
  AU: {
    code: 'AU',
    name: 'Australia',
    shortName: 'AU',
    launchBadge: 'Launch market',
    currencyCode: 'AUD',
    currencySymbol: 'A$',
    fxFromAud: 1.0,
    taxLabel: '+ GST',
    businessIdLabel: 'Australian Business Number (ABN)',
    businessIdPlaceholder: '48 612 904 331',
    privacyFramework: 'Australian Privacy Act (APP)',
    regulatoryBody: 'ACQSC & NDIS Quality & Safeguards',
    clinicalCheckExample: 'AHPRA RN/EN Registration',
    clearanceCheckExample: 'NDIS Worker Screening & Police Check',
    phoneCountryCode: '+61',
    phonePlaceholder: '+61 412 345 678',
    suburbLabel: 'Suburb',
    suburbPlaceholder: 'Parramatta',
    regionLabel: 'State',
    regionPlaceholder: 'NSW',
    regions: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'],
    postalLabel: 'Postcode',
    postalPlaceholder: '2150',
    defaultTimezone: 'Australia/Sydney',
    timezones: [
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Brisbane',
      'Australia/Adelaide',
      'Australia/Perth',
      'Australia/Hobart',
      'Australia/Darwin',
    ],
    sectors: ['Residential Aged Care', 'NDIS & Disability Support', 'Home & Community Care'],
    providerDensityNote: '2,600+ aged care homes & 18,000+ NDIS providers under 24/7 RN mandates',
  },
  US: {
    code: 'US',
    name: 'United States',
    shortName: 'US',
    currencyCode: 'USD',
    currencySymbol: '$',
    fxFromAud: 0.66,
    taxLabel: '+ applicable tax',
    businessIdLabel: 'EIN / NPI Organisation ID',
    businessIdPlaceholder: '84-2910482',
    privacyFramework: 'HIPAA & State Workforce Privacy',
    regulatoryBody: 'CMS & State Health Departments',
    clinicalCheckExample: 'State BON RN/LPN & CNA License',
    clearanceCheckExample: 'OIG Exclusion & State Background Check',
    phoneCountryCode: '+1',
    phonePlaceholder: '+1 (555) 234-5678',
    suburbLabel: 'City',
    suburbPlaceholder: 'Austin',
    regionLabel: 'State',
    regionPlaceholder: 'TX',
    regions: ['CA', 'TX', 'FL', 'NY', 'PA', 'OH', 'IL', 'NC', 'GA', 'WA', 'MA', 'CO'],
    postalLabel: 'ZIP Code',
    postalPlaceholder: '78701',
    defaultTimezone: 'America/New_York',
    timezones: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Phoenix',
    ],
    sectors: ['Skilled Nursing (SNF)', 'Assisted Living & Memory Care', 'Home Health & IDD Care'],
    providerDensityNote: '15,000+ skilled nursing, 30,000+ assisted living & 40,000+ home-care agencies',
  },
  UK: {
    code: 'UK',
    name: 'United Kingdom',
    shortName: 'UK',
    currencyCode: 'GBP',
    currencySymbol: '£',
    fxFromAud: 0.52,
    taxLabel: '+ VAT',
    businessIdLabel: 'Company No. / CQC Provider ID',
    businessIdPlaceholder: '1-1016582914',
    privacyFramework: 'UK GDPR & Data Protection Act 2018',
    regulatoryBody: 'CQC, Care Inspectorate & CIW',
    clinicalCheckExample: 'NMC PIN & Care Certificate',
    clearanceCheckExample: 'Enhanced DBS & Right to Work',
    phoneCountryCode: '+44',
    phonePlaceholder: '+44 7700 900123',
    suburbLabel: 'Town / City',
    suburbPlaceholder: 'Manchester',
    regionLabel: 'Region',
    regionPlaceholder: 'England',
    regions: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
    postalLabel: 'Postcode',
    postalPlaceholder: 'M1 4BT',
    defaultTimezone: 'Europe/London',
    timezones: ['Europe/London'],
    sectors: ['Residential Care Homes', 'Domiciliary & Live-in Care', 'Supported Living'],
    providerDensityNote: '17,000+ CQC-registered care homes & 13,000+ domiciliary care providers',
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    shortName: 'CA',
    currencyCode: 'CAD',
    currencySymbol: 'C$',
    fxFromAud: 0.90,
    taxLabel: '+ GST/HST',
    businessIdLabel: 'CRA Business Number (BN)',
    businessIdPlaceholder: '89241 0021 RC0001',
    privacyFramework: 'PIPEDA & Provincial PHIPA',
    regulatoryBody: 'Provincial Health Ministries & Colleges',
    clinicalCheckExample: 'Provincial RN/RPN/LPN & PSW Credential',
    clearanceCheckExample: 'Vulnerable Sector Check (VSC) & CPR',
    phoneCountryCode: '+1',
    phonePlaceholder: '+1 (416) 555-0192',
    suburbLabel: 'City',
    suburbPlaceholder: 'Toronto',
    regionLabel: 'Province',
    regionPlaceholder: 'ON',
    regions: ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'],
    postalLabel: 'Postal Code',
    postalPlaceholder: 'M5V 2T6',
    defaultTimezone: 'America/Toronto',
    timezones: [
      'America/Toronto',
      'America/Vancouver',
      'America/Edmonton',
      'America/Winnipeg',
      'America/Halifax',
    ],
    sectors: ['Long-Term Care (LTC)', 'Retirement & Assisted Living', 'Home & Community Care'],
    providerDensityNote: '2,000+ LTC homes, 3,200+ retirement residences & regional home-care networks',
  },
};

export const MARKET_LIST: MarketConfig[] = [
  MARKETS.AU,
  MARKETS.US,
  MARKETS.UK,
  MARKETS.CA,
];

export const ALL_TIMEZONE_GROUPS: Array<{ label: string; zones: string[] }> = [
  { label: 'Australia (Launch)', zones: MARKETS.AU.timezones },
  { label: 'United States', zones: MARKETS.US.timezones },
  { label: 'United Kingdom', zones: MARKETS.UK.timezones },
  { label: 'Canada', zones: MARKETS.CA.timezones },
];

/**
 * Formats an amount stored in AUD cents into the selected market's display currency.
 * For AUD, returns exact value; for other markets, applies indicative conversion rounded cleanly.
 */
export function formatMarketCents(
  audCents: number,
  market: MarketConfig,
  opts?: { decimals?: number; includeCode?: boolean }
): string {
  const decimals = opts?.decimals ?? 0;
  const converted = (audCents / 100) * market.fxFromAud;
  const rounded = decimals === 0 ? Math.round(converted) : converted;
  const formatted = rounded.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${market.currencySymbol}${formatted}${opts?.includeCode ? ` ${market.currencyCode}` : ''}`;
}

export function formatMarketDollars(
  audDollars: number,
  market: MarketConfig,
  opts?: { decimals?: number }
): string {
  return formatMarketCents(audDollars * 100, market, opts);
}

export function convertAudRate(audRate: number, market: MarketConfig): number {
  return Math.round(audRate * market.fxFromAud);
}

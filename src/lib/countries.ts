export interface CountryInfo {
  code: string;
  name: string;
  nameHu: string;
  localName: string;
  currency: string;
  isEU: boolean;
}

export const COUNTRIES: CountryInfo[] = [
  { code: 'HU', name: 'Hungary', nameHu: 'Magyarország', localName: 'Magyarország', currency: 'HUF', isEU: true },
  { code: 'DE', name: 'Germany', nameHu: 'Németország', localName: 'Deutschland', currency: 'EUR', isEU: true },
  { code: 'AT', name: 'Austria', nameHu: 'Ausztria', localName: 'Österreich', currency: 'EUR', isEU: true },
  { code: 'SK', name: 'Slovakia', nameHu: 'Szlovákia', localName: 'Slovensko', currency: 'EUR', isEU: true },
  { code: 'CZ', name: 'Czechia', nameHu: 'Csehország', localName: 'Česko', currency: 'CZK', isEU: true },
  { code: 'PL', name: 'Poland', nameHu: 'Lengyelország', localName: 'Polska', currency: 'PLN', isEU: true },
  { code: 'RO', name: 'Romania', nameHu: 'Románia', localName: 'România', currency: 'RON', isEU: true },
  { code: 'FR', name: 'France', nameHu: 'Franciaország', localName: 'France', currency: 'EUR', isEU: true },
  { code: 'IT', name: 'Italy', nameHu: 'Olaszország', localName: 'Italia', currency: 'EUR', isEU: true },
  { code: 'ES', name: 'Spain', nameHu: 'Spanyolország', localName: 'España', currency: 'EUR', isEU: true },
  { code: 'NL', name: 'Netherlands', nameHu: 'Hollandia', localName: 'Nederland', currency: 'EUR', isEU: true },
  { code: 'BE', name: 'Belgium', nameHu: 'Belgium', localName: 'België', currency: 'EUR', isEU: true },
  { code: 'SE', name: 'Sweden', nameHu: 'Svédország', localName: 'Sverige', currency: 'SEK', isEU: true },
  { code: 'DK', name: 'Denmark', nameHu: 'Dánia', localName: 'Danmark', currency: 'DKK', isEU: true },
  { code: 'FI', name: 'Finland', nameHu: 'Finnország', localName: 'Suomi', currency: 'EUR', isEU: true },
  { code: 'PT', name: 'Portugal', nameHu: 'Portugália', localName: 'Portugal', currency: 'EUR', isEU: true },
  { code: 'IE', name: 'Ireland', nameHu: 'Írország', localName: 'Éire', currency: 'EUR', isEU: true },
  { code: 'HR', name: 'Croatia', nameHu: 'Horvátország', localName: 'Hrvatska', currency: 'EUR', isEU: true },
  { code: 'SI', name: 'Slovenia', nameHu: 'Szlovénia', localName: 'Slovenija', currency: 'EUR', isEU: true },
  { code: 'BG', name: 'Bulgaria', nameHu: 'Bulgária', localName: 'България', currency: 'BGN', isEU: true },
  { code: 'CH', name: 'Switzerland', nameHu: 'Svájc', localName: 'Schweiz', currency: 'CHF', isEU: false },
  { code: 'GB', name: 'United Kingdom', nameHu: 'Egyesült Királyság', localName: 'UK', currency: 'GBP', isEU: false },
  { code: 'US', name: 'United States', nameHu: 'Egyesült Államok', localName: 'USA', currency: 'USD', isEU: false },
  { code: 'CA', name: 'Canada', nameHu: 'Kanada', localName: 'Canada', currency: 'CAD', isEU: false },
  { code: 'JP', name: 'Japan', nameHu: 'Japán', localName: '日本', currency: 'JPY', isEU: false },
];

export const COUNTRY_MAP = new Map<string, CountryInfo>(
  COUNTRIES.map((c) => [c.code.toUpperCase(), c])
);

export function getCountry(code?: string | null): CountryInfo {
  if (!code) return COUNTRY_MAP.get('HU')!;
  return COUNTRY_MAP.get(code.toUpperCase()) || {
    code: code.toUpperCase(),
    name: code.toUpperCase(),
    nameHu: code.toUpperCase(),
    localName: code.toUpperCase(),
    currency: 'EUR',
    isEU: false,
  };
}

export function formatCountryName(countryOrCode: CountryInfo | string | null | undefined, lang: string = 'en'): string {
  const c = typeof countryOrCode === 'string' || !countryOrCode ? getCountry(countryOrCode) : countryOrCode;
  return lang === 'hu' ? c.nameHu : c.name;
}

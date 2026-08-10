// Kuratierte 13F-Star-Investoren. Die CIKs wurden am 10.08.2026 gegen
// data.sec.gov/submissions geprüft; Elliott wurde dabei von der fehlerhaft
// duplizierten Icahn-CIK auf seine aktuelle eigene CIK korrigiert.
export interface StarInvestor {
  name: string;
  manager: string;
  cik: string;
}

export const STAR_INVESTORS: readonly StarInvestor[] = [
  { name: "Berkshire Hathaway", manager: "Warren Buffett", cik: "0001067983" },
  { name: "Duquesne Family Office", manager: "Stanley Druckenmiller", cik: "0001536411" },
  { name: "Pershing Square Capital Management", manager: "Bill Ackman", cik: "0001336528" },
  { name: "Bridgewater Associates", manager: "Ray Dalio", cik: "0001350694" },
  { name: "Appaloosa Management", manager: "David Tepper", cik: "0001656456" },
  { name: "Himalaya Capital Management", manager: "Li Lu", cik: "0001709323" },
  { name: "ARK Investment Management", manager: "Cathie Wood", cik: "0001697748" },
  { name: "Point72 Asset Management", manager: "Steven Cohen", cik: "0001603466" },
  { name: "Coatue Management", manager: "Philippe Laffont", cik: "0001135730" },
  { name: "Soros Fund Management", manager: "George Soros", cik: "0001029160" },
  { name: "Baupost Group", manager: "Seth Klarman", cik: "0001061768" },
  { name: "Tiger Global Management", manager: "Chase Coleman", cik: "0001167483" },
  { name: "Elliott Investment Management", manager: "Paul Singer", cik: "0001791786" },
  { name: "Icahn Enterprises", manager: "Carl Icahn", cik: "0000921669" },
];

/** The theme colours for code that doesn't use CSS. Keep in sync with ../theme.css. */
export const colors = {
  sunken: "#082a2e",
  well: "#0a3237",
  surface: "#0d3a3f",
  hover: "#10474e",
  raised: "#12505a",
  raisedHover: "#185f69",
  lineSoft: "#0f4047",
  line: "#1a5058",
  lineStrong: "#2f7a80",
  ink: "#f6efd8",
  soft: "#cfe3e3",
  muted: "#b2d4d6",
  faint: "#8dbcbe",
  dim: "#4f8a8e",
  accent: "#f2c45a",
  accentHover: "#f6d070",
  accentDark: "#d8a63a",
  accentInk: "#1d1609",
  decoded: "#9ad4a4",
  partial: "#8ec5ec",
  hypothesis: "#c9b3f0",
  error: "#ff9d8f",
  errorDark: "#b13f2a",
} as const;

export type ColorName = keyof typeof colors;

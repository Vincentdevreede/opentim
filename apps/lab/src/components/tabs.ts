/** Ids that tie the tabs of a `LabTabs` to the panel they switch. */

export const tabIdOf = (id: string, value: string) => `${id}-tab-${value}`;
export const panelIdOf = (id: string) => `${id}-panel`;

/** The attributes of the panel that the `LabTabs` with this id switch, while `value` is the selected tab. */
export const tabPanel = (id: string, value: string) => ({
  role: "tabpanel",
  id: panelIdOf(id),
  "aria-labelledby": tabIdOf(id, value),
});

/** The tab an arrow, Home or End key moves to among the enabled tabs, or undefined for other keys. */
export function tabAfterKey<T>(key: string, enabled: readonly T[], current: T): T | undefined {
  if (!enabled.length) return undefined;
  const at = Math.max(0, enabled.indexOf(current));
  if (key === "ArrowRight") return enabled[(at + 1) % enabled.length];
  if (key === "ArrowLeft") return enabled[(at - 1 + enabled.length) % enabled.length];
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  return undefined;
}

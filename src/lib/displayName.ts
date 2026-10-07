// Presentation-only name formatting: "ian.hong" -> "Ian Hong". Never feed the result back into data (comparison, sorting,
// grouping, lookups, database writes); callers keep the raw name and format at the moment of rendering or export.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETED_SUFFIX = "（已刪除）";

function capitalizeFirst(segment: string): string {
  // Array.from splits by Unicode code point, so astral characters are never cut in half.
  const [first, ...rest] = Array.from(segment);
  return first.toUpperCase() + rest.join("");
}

export function formatDisplayName(name: string | null | undefined): string {
  if (typeof name !== "string" || name === "") return "";
  // An email (name fell back to it) or an id (name fell back to it) is shown as-is.
  if (name.includes("@") || UUID_PATTERN.test(name)) return name;
  return name
    .split(/[._]/)
    .filter((segment) => segment !== "")
    .map(capitalizeFirst)
    .join(" ");
}

// Format a name that may carry the "（已刪除）" marker (appended to the raw name when a deleted user's history is shown):
// format the name first, then put the marker back.
export function formatMemberName(name: string | null | undefined): string {
  if (typeof name === "string" && name.endsWith(DELETED_SUFFIX)) {
    return formatDisplayName(name.slice(0, -DELETED_SUFFIX.length)) + DELETED_SUFFIX;
  }
  return formatDisplayName(name);
}

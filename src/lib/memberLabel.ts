type NamedProfile = { id: string; display_name?: string | null; email?: string | null };
type HistoryLabel = { display_name: string; deleted_at?: string | null };

// Same rule as the delete-user handler and the SQL side: an empty string counts as a missing value.
export function memberDisplayName(profile: NamedProfile): string {
  return profile.display_name || profile.email || profile.id;
}

// A live profile is always shown by its own name. Only a user whose profile is gone AND whose history label is
// marked deleted gets the "（已刪除）" suffix; deletion state never depends on display_name being empty.
export function resolveStatusMemberName(status: { profile?: NamedProfile | null; historyLabel?: HistoryLabel | null }): string {
  if (status.profile) return memberDisplayName(status.profile);
  if (status.historyLabel) {
    return status.historyLabel.deleted_at ? `${status.historyLabel.display_name}（已刪除）` : status.historyLabel.display_name;
  }
  return "Unknown";
}

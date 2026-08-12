/** HH:MM, 24-hour, zero-padded -- locale-independent so WatchPill reads the same everywhere, not whatever the host's own locale happens to format times as. */
export function formatClock(date: Date): string {
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

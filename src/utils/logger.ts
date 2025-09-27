// Helper function to check if event contains @ai
export function isAiEvent(description?: string, title?: string): boolean {
	const textToCheck = `${title || ""} ${description || ""}`.toLowerCase();
	return textToCheck.includes("@ai");
}

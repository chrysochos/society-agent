// Utility functions
export function formatDate(date: Date): string {
	return date.toISOString().split("T")[0]
}

export function isValidEmail(email: string): boolean {
	const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	return regex.test(email)
}

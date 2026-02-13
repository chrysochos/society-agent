// Type declarations
declare module "*.svg" {
	const content: string
	export default content
}

declare module "*.png" {
	const content: string
	export default content
}

interface User {
	id: string
	name: string
	email: string
}

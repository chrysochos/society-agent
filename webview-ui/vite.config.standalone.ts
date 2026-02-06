// kilocode_change - new file
/**
 * Vite Config for Standalone Web Server
 * Builds a simple SPA for Society Agent server
 */

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
	plugins: [react()],
	root: ".",
	build: {
		outDir: "../src/webview-ui/build-standalone",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, "index-standalone.html"),
			},
		},
	},
	server: {
		port: 5173,
	},
})

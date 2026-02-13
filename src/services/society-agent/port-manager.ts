// kilocode_change - new file
import * as net from "net"

/**
 * Port Manager - Finds available ports for agent HTTP servers
 */

export class PortManager {
	private static usedPorts = new Set<number>()

	/**
	 * Find an available port in the specified range
	 */
	static async findAvailablePort(min: number = 3000, max: number = 4000): Promise<number> {
		for (let port = min; port <= max; port++) {
			if (this.usedPorts.has(port)) {
				continue
			}

			if (await this.isPortAvailable(port)) {
				this.usedPorts.add(port)
				return port
			}
		}

		throw new Error(`No available ports in range ${min}-${max}`)
	}

	/**
	 * Check if a port is available
	 */
	private static isPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer()

			server.once("error", (err: any) => {
				if (err.code === "EADDRINUSE") {
					resolve(false)
				} else {
					resolve(false)
				}
			})

			server.once("listening", () => {
				server.close()
				resolve(true)
			})

			server.listen(port, "127.0.0.1")
		})
	}

	/**
	 * Release a port
	 */
	static releasePort(port: number): void {
		this.usedPorts.delete(port)
	}

	/**
	 * Get all used ports
	 */
	static getUsedPorts(): number[] {
		return Array.from(this.usedPorts)
	}
}

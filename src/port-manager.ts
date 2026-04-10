// Society Agent - Port Manager with persistent allocation tracking
import * as net from "net"
import * as fs from "fs"
import * as path from "path"

/**
 * Port allocation record - tracked per project/service
 */
export interface PortAllocation {
	port: number
	projectId: string
	serviceName: string        // e.g., "api", "frontend", "db"
	allocatedBy?: string       // agent ID that requested it
	allocatedAt: string        // ISO timestamp
	description?: string       // optional description
	lastUsed?: string          // last time a process was detected on this port
}

/**
 * Port Manager - Allocates and tracks ports for projects
 * 
 * Key features:
 * - Persistent: Same service name always gets the same port
 * - Project-scoped: Each project's ports are isolated
 * - Protected: Allocated ports can only be killed by owning project
 * - Manual release: Ports stay allocated until explicitly released
 */
export class PortManager {
	private static allocations = new Map<number, PortAllocation>()
	private static serviceToPort = new Map<string, number>() // "projectId:serviceName" -> port
	private static storePath: string | null = null
	private static MIN_PORT = 3000
	private static MAX_PORT = 9999
	private static SYSTEM_PORT = parseInt(process.env.PORT || "4000", 10)
	
	// Callback to notify when allocations change (for protected ports integration)
	private static onAllocationChange: ((allocations: PortAllocation[]) => void) | null = null

	/**
	 * Initialize the port manager with a storage path
	 */
	static initialize(workspacePath: string): void {
		this.storePath = path.join(workspacePath, ".port-allocations.json")
		this.loadAllocations()
	}

	/**
	 * Set callback for when allocations change (used to update PROTECTED_PORTS)
	 */
	static setAllocationChangeCallback(callback: (allocations: PortAllocation[]) => void): void {
		this.onAllocationChange = callback
	}

	/**
	 * Request a port for a service. If the service already has a port, returns the same one.
	 * If not, allocates a new available port (or a specific requested port).
	 */
	static async requestPort(
		projectId: string,
		serviceName: string,
		options?: { description?: string; allocatedBy?: string; preferredPort?: number }
	): Promise<{ port: number; isNew: boolean }> {
		const key = `${projectId}:${serviceName}`
		
		// Check if this service already has an allocated port
		const existingPort = this.serviceToPort.get(key)
		if (existingPort !== undefined) {
			// Update lastUsed
			const allocation = this.allocations.get(existingPort)
			if (allocation) {
				allocation.lastUsed = new Date().toISOString()
				this.saveAllocations()
			}
			return { port: existingPort, isNew: false }
		}
		
		let port: number
		
		// If user requested a specific port, try to use it
		if (options?.preferredPort) {
			const preferred = options.preferredPort
			
			// Check if port is already allocated
			if (this.allocations.has(preferred)) {
				const existing = this.allocations.get(preferred)!
				throw new Error(`Port ${preferred} is already allocated to ${existing.projectId}:${existing.serviceName}`)
			}
			
			// Check if port is in use by another process
			const inUse = await this.isPortInUse(preferred)
			if (inUse) {
				throw new Error(`Port ${preferred} is already in use by another process`)
			}
			
			port = preferred
		} else {
			// Find a new available port
			port = await this.findAvailablePortInRange(this.MIN_PORT, this.MAX_PORT, false)
		}
		
		// Create allocation record
		const allocation: PortAllocation = {
			port,
			projectId,
			serviceName,
			allocatedBy: options?.allocatedBy,
			allocatedAt: new Date().toISOString(),
			description: options?.description,
			lastUsed: new Date().toISOString(),
		}
		
		this.allocations.set(port, allocation)
		this.serviceToPort.set(key, port)
		this.saveAllocations()
		this.notifyChange()
		
		return { port, isNew: true }
	}

	/**
	 * Check if a port is in use
	 */
	static async isPortInUse(port: number): Promise<boolean> {
		const net = await import("net")
		return new Promise((resolve) => {
			const server = net.createServer()
			server.once("error", () => resolve(true))
			server.once("listening", () => {
				server.close()
				resolve(false)
			})
			server.listen(port)
		})
	}

	/**
	 * Release a port (mark it as available for reuse)
	 */
	static releasePort(port: number, projectId?: string): { success: boolean; reason?: string } {
		const allocation = this.allocations.get(port)
		
		if (!allocation) {
			return { success: false, reason: `Port ${port} is not allocated` }
		}
		
		if (projectId && allocation.projectId !== projectId) {
			return { 
				success: false, 
				reason: `Port ${port} belongs to project "${allocation.projectId}", not "${projectId}"` 
			}
		}
		
		const key = `${allocation.projectId}:${allocation.serviceName}`
		this.allocations.delete(port)
		this.serviceToPort.delete(key)
		this.saveAllocations()
		this.notifyChange()
		
		return { success: true }
	}

	/**
	 * Get all ports allocated to a project
	 */
	static getProjectPorts(projectId: string): PortAllocation[] {
		return Array.from(this.allocations.values())
			.filter(a => a.projectId === projectId)
	}

	/**
	 * Get all allocated ports (for admin visibility)
	 */
	static getAllAllocations(): PortAllocation[] {
		return Array.from(this.allocations.values())
	}

	/**
	 * Check if a port is allocated and to which project
	 */
	static getPortOwner(port: number): PortAllocation | null {
		return this.allocations.get(port) || null
	}

	/**
	 * Check if a project can kill a port (owns it or it's unallocated)
	 */
	static canProjectKillPort(port: number, projectId: string): { allowed: boolean; reason?: string } {
		// System port is never killable
		if (port === this.SYSTEM_PORT) {
			return { allowed: false, reason: `Port ${port} is the system server` }
		}
		
		const allocation = this.allocations.get(port)
		
		// Unallocated ports can be killed by anyone
		if (!allocation) {
			return { allowed: true }
		}
		
		// Allocated ports can only be killed by the owning project
		if (allocation.projectId === projectId) {
			return { allowed: true }
		}
		
		return { 
			allowed: false, 
			reason: `Port ${port} is allocated to project "${allocation.projectId}" (service: ${allocation.serviceName}). Only that project can kill it.`
		}
	}

	/**
	 * Find an available port in the range
	 */
	static async findAvailablePort(minPort = 3000, maxPort = 4000): Promise<number> {
		const port = await this.findAvailablePortInRange(minPort, maxPort, true)

		// Legacy behavior: reserve immediately so the next call doesn't return same port.
		if (!this.allocations.has(port)) {
			const allocation: PortAllocation = {
				port,
				projectId: "legacy",
				serviceName: `legacy-${port}`,
				allocatedAt: new Date().toISOString(),
				lastUsed: new Date().toISOString(),
			}
			this.allocations.set(port, allocation)
			this.serviceToPort.set(`${allocation.projectId}:${allocation.serviceName}`, port)
			this.saveAllocations()
			this.notifyChange()
		}

		return port
	}

	private static async findAvailablePortInRange(minPort: number, maxPort: number, checkLegacyAvailability: boolean): Promise<number> {
		for (let port = minPort; port <= maxPort; port++) {
			// Skip system port
			if (port === this.SYSTEM_PORT) continue
			
			// Skip already allocated ports
			if (this.allocations.has(port)) continue
			
			// Check if port is actually available on the system
			if (await this.isPortAvailable(port)) {
				return port
			}
		}
		
		const lower = checkLegacyAvailability ? minPort : this.MIN_PORT
		const upper = checkLegacyAvailability ? maxPort : this.MAX_PORT
		throw new Error(`No available ports in range ${lower}-${upper}`)
	}

	/**
	 * Check if a port is available on the system
	 */
	private static isPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer()

			server.once("error", () => {
				resolve(false)
			})

			server.once("listening", () => {
				server.close()
				resolve(true)
			})

			server.listen(port, "127.0.0.1")
		})
	}

	/**
	 * Load allocations from disk
	 */
	private static loadAllocations(): void {
		if (!this.storePath || !fs.existsSync(this.storePath)) {
			return
		}
		
		try {
			const data = fs.readFileSync(this.storePath, "utf-8")
			const allocations: PortAllocation[] = JSON.parse(data)
			
			this.allocations.clear()
			this.serviceToPort.clear()
			
			for (const alloc of allocations) {
				this.allocations.set(alloc.port, alloc)
				this.serviceToPort.set(`${alloc.projectId}:${alloc.serviceName}`, alloc.port)
			}
			
			console.log(`[PortManager] Loaded ${allocations.length} port allocations`)
		} catch (err) {
			console.error(`[PortManager] Failed to load allocations:`, err)
		}
	}

	/**
	 * Save allocations to disk
	 */
	private static saveAllocations(): void {
		if (!this.storePath) {
			return
		}
		
		try {
			const allocations = Array.from(this.allocations.values())
			fs.writeFileSync(this.storePath, JSON.stringify(allocations, null, 2))
		} catch (err) {
			console.error(`[PortManager] Failed to save allocations:`, err)
		}
	}

	/**
	 * Notify listeners of allocation changes
	 */
	private static notifyChange(): void {
		if (this.onAllocationChange) {
			this.onAllocationChange(this.getAllAllocations())
		}
	}

	// Legacy methods for backward compatibility
	static getUsedPorts(): number[] {
		return Array.from(this.allocations.keys())
	}
}

// Society Agent - new file
import { describe, it, expect, beforeEach } from "vitest"
import { PortManager } from "../port-manager"

describe("PortManager", () => {
	beforeEach(() => {
		// Clear used ports between tests
		for (const port of PortManager.getUsedPorts()) {
			PortManager.releasePort(port)
		}
	})

	describe("findAvailablePort", () => {
		it("should find a port in the default range", async () => {
			const port = await PortManager.findAvailablePort()
			expect(port).toBeGreaterThanOrEqual(3000)
			expect(port).toBeLessThanOrEqual(4000)
		})

		it("should find a port in a custom range", async () => {
			const port = await PortManager.findAvailablePort(9000, 9100)
			expect(port).toBeGreaterThanOrEqual(9000)
			expect(port).toBeLessThanOrEqual(9100)
		})

		it("should not return the same port twice", async () => {
			const port1 = await PortManager.findAvailablePort(9200, 9300)
			const port2 = await PortManager.findAvailablePort(9200, 9300)
			expect(port1).not.toBe(port2)
		})

		it("should throw when no ports are available in a tiny range", async () => {
			// Use a range of 1 port, find it, then try again
			const port = await PortManager.findAvailablePort(9400, 9400)
			expect(port).toBe(9400)
			await expect(PortManager.findAvailablePort(9400, 9400)).rejects.toThrow(
				"No available ports",
			)
		})
	})

	describe("releasePort", () => {
		it("should allow reuse of released ports", async () => {
			const port = await PortManager.findAvailablePort(9500, 9500)
			expect(port).toBe(9500)

			PortManager.releasePort(port)

			const reused = await PortManager.findAvailablePort(9500, 9500)
			expect(reused).toBe(9500)
		})
	})

	describe("getUsedPorts", () => {
		it("should track used ports", async () => {
			const port = await PortManager.findAvailablePort(9600, 9610)
			const used = PortManager.getUsedPorts()
			expect(used).toContain(port)
		})

		it("should return empty when no ports are used", () => {
			const used = PortManager.getUsedPorts()
			expect(used).toEqual([])
		})
	})
})

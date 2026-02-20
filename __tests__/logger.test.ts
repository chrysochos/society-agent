// Society Agent - new file
/**
 * Tests for Society Agent Logger (OutputChannel-based logging)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChannelLog, setSocietyLog, getLog, type SocietyLog } from "../logger"

describe("SocietyLog", () => {
	describe("createChannelLog", () => {
		let channel: { appendLine: ReturnType<typeof vi.fn> }
		let log: SocietyLog

		beforeEach(() => {
			channel = { appendLine: vi.fn() }
			log = createChannelLog(channel)
		})

		it("should format info messages", () => {
			log.info("test message")
			expect(channel.appendLine).toHaveBeenCalledWith("[SocietyAgent] [INFO] test message")
		})

		it("should format warn messages", () => {
			log.warn("warning here")
			expect(channel.appendLine).toHaveBeenCalledWith("[SocietyAgent] [WARN] warning here")
		})

		it("should format error messages", () => {
			log.error("something broke")
			expect(channel.appendLine).toHaveBeenCalledWith("[SocietyAgent] [ERROR] something broke")
		})

		it("should format debug messages", () => {
			log.debug("debug info")
			expect(channel.appendLine).toHaveBeenCalledWith("[SocietyAgent] [DEBUG] debug info")
		})

		it("should append extra args as stringified values", () => {
			log.info("value:", 42)
			expect(channel.appendLine).toHaveBeenCalledWith("[SocietyAgent] [INFO] value: 42")
		})

		it("should stringify object args", () => {
			log.info("data:", { foo: "bar" })
			expect(channel.appendLine).toHaveBeenCalledWith('[SocietyAgent] [INFO] data: {"foo":"bar"}')
		})

		it("should format Error objects", () => {
			const err = new Error("boom")
			log.error("failed:", err)
			const output = channel.appendLine.mock.calls[0][0] as string
			expect(output).toContain("[SocietyAgent] [ERROR] failed:")
			expect(output).toContain("boom")
		})

		it("should use custom prefix", () => {
			const customLog = createChannelLog(channel, "[Custom]")
			customLog.info("hello")
			expect(channel.appendLine).toHaveBeenCalledWith("[Custom] [INFO] hello")
		})
	})

	describe("global log", () => {
		it("should default to no-op", () => {
			// getLog() should not throw even when no logger is set
			const log = getLog()
			expect(() => log.info("test")).not.toThrow()
			expect(() => log.warn("test")).not.toThrow()
			expect(() => log.error("test")).not.toThrow()
			expect(() => log.debug("test")).not.toThrow()
		})

		it("should use the set logger", () => {
			const channel = { appendLine: vi.fn() }
			const log = createChannelLog(channel)
			setSocietyLog(log)

			getLog().info("global test")
			expect(channel.appendLine).toHaveBeenCalledWith("[SocietyAgent] [INFO] global test")
		})
	})
})

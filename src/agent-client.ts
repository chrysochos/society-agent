// kilocode_change - new file
import * as http from "http"
import * as https from "https"

/**
 * Agent Client - HTTP client for sending messages to other agents
 */

export interface MessageOptions {
	from: string
	to: string
	type: string
	content: any
	timestamp?: string
}

export interface AttachmentData {
	filename: string
	mimeType: string
	data: Buffer
}

export class AgentClient {
	/**
	 * Send text message to another agent
	 */
	static async sendMessage(url: string, message: MessageOptions, timeout: number = 5000): Promise<void> {
		const payload = {
			...message,
			timestamp: message.timestamp || new Date().toISOString(),
		}

		const response = await this.post(
			`${url}/api/message`,
			JSON.stringify(payload),
			{
				"Content-Type": "application/json",
			},
			timeout,
		)

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}
	}

	/**
	 * Send message with attachments
	 */
	static async sendMessageWithAttachments(
		url: string,
		message: MessageOptions,
		attachments: AttachmentData[],
		timeout: number = 30000,
	): Promise<void> {
		const boundary = `----FormBoundary${Date.now()}`
		const parts: Buffer[] = []

		// Add message fields
		parts.push(Buffer.from(`--${boundary}\r\n`))
		parts.push(Buffer.from(`Content-Disposition: form-data; name="from"\r\n\r\n`))
		parts.push(Buffer.from(`${message.from}\r\n`))

		parts.push(Buffer.from(`--${boundary}\r\n`))
		parts.push(Buffer.from(`Content-Disposition: form-data; name="to"\r\n\r\n`))
		parts.push(Buffer.from(`${message.to}\r\n`))

		parts.push(Buffer.from(`--${boundary}\r\n`))
		parts.push(Buffer.from(`Content-Disposition: form-data; name="type"\r\n\r\n`))
		parts.push(Buffer.from(`${message.type}\r\n`))

		parts.push(Buffer.from(`--${boundary}\r\n`))
		parts.push(Buffer.from(`Content-Disposition: form-data; name="content"\r\n\r\n`))
		parts.push(Buffer.from(`${message.content}\r\n`))

		parts.push(Buffer.from(`--${boundary}\r\n`))
		parts.push(Buffer.from(`Content-Disposition: form-data; name="timestamp"\r\n\r\n`))
		parts.push(Buffer.from(`${message.timestamp || new Date().toISOString()}\r\n`))

		// Add attachments
		for (const attachment of attachments) {
			parts.push(Buffer.from(`--${boundary}\r\n`))
			parts.push(
				Buffer.from(
					`Content-Disposition: form-data; name="attachments"; filename="${attachment.filename}"\r\n`,
				),
			)
			parts.push(Buffer.from(`Content-Type: ${attachment.mimeType}\r\n\r\n`))
			parts.push(attachment.data)
			parts.push(Buffer.from("\r\n"))
		}

		// End boundary
		parts.push(Buffer.from(`--${boundary}--\r\n`))

		const body = Buffer.concat(parts)

		const response = await this.post(
			`${url}/api/message-multi`,
			body,
			{
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			timeout,
		)

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}
	}

	/**
	 * Check if agent is online
	 */
	static async checkStatus(url: string, timeout: number = 2000): Promise<boolean> {
		try {
			const response = await this.get(`${url}/api/status`, timeout)
			return response.ok
		} catch {
			return false
		}
	}

	/**
	 * HTTP POST request
	 */
	private static post(
		url: string,
		body: string | Buffer,
		headers: Record<string, string>,
		timeout: number,
	): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
		return new Promise((resolve, reject) => {
			const urlObj = new URL(url)
			const client = urlObj.protocol === "https:" ? https : http

			const options = {
				hostname: urlObj.hostname,
				port: urlObj.port,
				path: urlObj.pathname + urlObj.search,
				method: "POST",
				headers: {
					...headers,
					"Content-Length": Buffer.byteLength(body),
				},
				timeout,
			}

			const req = client.request(options, (res) => {
				const chunks: Buffer[] = []

				res.on("data", (chunk) => {
					chunks.push(chunk)
				})

				res.on("end", () => {
					resolve({
						ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
						status: res.statusCode || 0,
						statusText: res.statusMessage || "",
						body: Buffer.concat(chunks).toString("utf-8"),
					})
				})
			})

			req.on("error", reject)
			req.on("timeout", () => {
				req.destroy()
				reject(new Error("Request timeout"))
			})

			req.write(body)
			req.end()
		})
	}

	/**
	 * HTTP GET request
	 */
	private static get(
		url: string,
		timeout: number,
	): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
		return new Promise((resolve, reject) => {
			const urlObj = new URL(url)
			const client = urlObj.protocol === "https:" ? https : http

			const options = {
				hostname: urlObj.hostname,
				port: urlObj.port,
				path: urlObj.pathname + urlObj.search,
				method: "GET",
				timeout,
			}

			const req = client.request(options, (res) => {
				const chunks: Buffer[] = []

				res.on("data", (chunk) => {
					chunks.push(chunk)
				})

				res.on("end", () => {
					resolve({
						ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
						status: res.statusCode || 0,
						statusText: res.statusMessage || "",
						body: Buffer.concat(chunks).toString("utf-8"),
					})
				})
			})

			req.on("error", reject)
			req.on("timeout", () => {
				req.destroy()
				reject(new Error("Request timeout"))
			})

			req.end()
		})
	}
}

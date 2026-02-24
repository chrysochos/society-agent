// Society Agent - GitLoader for loading projects from GitLab/GitHub
/**
 * Git Loader
 *
 * Handles loading projects from Git repositories (GitLab, GitHub, etc.)
 * 
 * Key design principle: Platform code never edits its own running source.
 * All agent work happens in cloned workspaces under /workspaces/projects/<project-id>
 *
 * Features:
 * - Store and manage multiple SSH keys / tokens per repo
 * - Clone repos to isolated workspaces
 * - Checkout specific branches/refs
 * - Pull updates, push branches, open MRs (future)
 */

import * as fs from "fs"
import * as path from "path"
import { execSync, spawn } from "child_process"
import * as crypto from "crypto"
import { getLog } from "./logger"

const log = getLog()

// ==============================================================================
// Types
// ==============================================================================

/**
 * Credential type - SSH key or access token
 */
export type CredentialType = "ssh-key" | "token"

/**
 * A stored credential for Git authentication
 */
export interface GitCredential {
	/** Unique credential ID */
	id: string
	/** Human-readable name (e.g., "GitLab Deploy Key - myproject") */
	name: string
	/** Type of credential */
	type: CredentialType
	/** For SSH: the private key content. For token: the access token. */
	secret: string
	/** For SSH: optional public key for display purposes */
	publicKey?: string
	/** Git host this is for (e.g., "gitlab.com", "github.com", "*" for any) */
	host: string
	/** When created */
	createdAt: string
	/** Last used */
	lastUsedAt?: string
}

/**
 * Git repository configuration for a project
 */
export interface GitRepoConfig {
	/** Repository URL (SSH or HTTPS) */
	url: string
	/** Default branch/ref to use */
	defaultRef: string
	/** Currently checked out ref */
	currentRef?: string
	/** ID of credential to use for authentication */
	credentialId?: string
	/** When last synced from remote */
	lastSyncedAt?: string
	/** Whether there are local changes */
	hasLocalChanges?: boolean
}

/**
 * Result of a git operation
 */
export interface GitResult {
	success: boolean
	message: string
	/** stdout from git command */
	stdout?: string
	/** stderr from git command */
	stderr?: string
}

// ==============================================================================
// Credentials Store
// ==============================================================================

/**
 * Secure store for Git credentials.
 * Credentials are stored in .society/credentials.json with restricted permissions.
 */
export class CredentialsStore {
	private storePath: string
	private sshKeyDir: string
	private credentials: GitCredential[] = []

	constructor(workspacePath: string) {
		const societyDir = path.join(workspacePath, "projects", ".society")
		this.storePath = path.join(societyDir, "credentials.json")
		this.sshKeyDir = path.join(societyDir, "ssh-keys")
		
		// Ensure directories exist
		if (!fs.existsSync(societyDir)) {
			fs.mkdirSync(societyDir, { recursive: true })
		}
		if (!fs.existsSync(this.sshKeyDir)) {
			fs.mkdirSync(this.sshKeyDir, { mode: 0o700 })
		}
		
		this.load()
	}

	private load(): void {
		try {
			if (fs.existsSync(this.storePath)) {
				const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"))
				this.credentials = data.credentials || []
				log.info(`Loaded ${this.credentials.length} git credentials`)
			}
		} catch (err) {
			log.error("Failed to load credentials:", err)
			this.credentials = []
		}
	}

	private save(): void {
		try {
			fs.writeFileSync(
				this.storePath,
				JSON.stringify({ credentials: this.credentials, version: 1 }, null, 2),
				{ mode: 0o600 } // Only owner can read/write
			)
		} catch (err) {
			log.error("Failed to save credentials:", err)
		}
	}

	/**
	 * Add a new credential
	 */
	addCredential(cred: Omit<GitCredential, "id" | "createdAt">): GitCredential {
		const newCred: GitCredential = {
			...cred,
			id: crypto.randomUUID(),
			createdAt: new Date().toISOString(),
		}
		
		// For SSH keys, also write the key file for git to use
		if (cred.type === "ssh-key") {
			const keyPath = path.join(this.sshKeyDir, `${newCred.id}`)
			fs.writeFileSync(keyPath, cred.secret, { mode: 0o600 })
		}
		
		this.credentials.push(newCred)
		this.save()
		log.info(`Added credential: ${newCred.name} (${newCred.type}) for ${newCred.host}`)
		return newCred
	}

	/**
	 * Get credential by ID
	 */
	getCredential(id: string): GitCredential | undefined {
		return this.credentials.find(c => c.id === id)
	}

	/**
	 * Get credential by host (for auto-selection)
	 */
	getCredentialForHost(host: string): GitCredential | undefined {
		// First try exact match, then wildcard
		return this.credentials.find(c => c.host === host) ||
			   this.credentials.find(c => c.host === "*")
	}

	/**
	 * List all credentials (without secret values)
	 */
	listCredentials(): Array<Omit<GitCredential, "secret">> {
		return this.credentials.map(({ secret, ...rest }) => rest)
	}

	/**
	 * Delete a credential
	 */
	deleteCredential(id: string): boolean {
		const idx = this.credentials.findIndex(c => c.id === id)
		if (idx === -1) return false
		
		const cred = this.credentials[idx]
		
		// Remove SSH key file if it exists
		if (cred.type === "ssh-key") {
			const keyPath = path.join(this.sshKeyDir, `${id}`)
			if (fs.existsSync(keyPath)) {
				fs.unlinkSync(keyPath)
			}
		}
		
		this.credentials.splice(idx, 1)
		this.save()
		log.info(`Deleted credential: ${cred.name}`)
		return true
	}

	/**
	 * Get the path to an SSH key file for use with GIT_SSH_COMMAND
	 */
	getSSHKeyPath(credentialId: string): string | undefined {
		const cred = this.getCredential(credentialId)
		if (!cred || cred.type !== "ssh-key") return undefined
		return path.join(this.sshKeyDir, credentialId)
	}

	/**
	 * Update lastUsedAt for a credential
	 */
	markUsed(id: string): void {
		const cred = this.credentials.find(c => c.id === id)
		if (cred) {
			cred.lastUsedAt = new Date().toISOString()
			this.save()
		}
	}
}

// ==============================================================================
// Git Loader
// ==============================================================================

/**
 * GitLoader handles cloning, pulling, and pushing Git repositories.
 */
export class GitLoader {
	private workspacePath: string
	private projectsDir: string
	private credentials: CredentialsStore

	constructor(workspacePath: string, credentials: CredentialsStore) {
		this.workspacePath = workspacePath
		this.projectsDir = path.join(workspacePath, "projects")
		this.credentials = credentials
		
		if (!fs.existsSync(this.projectsDir)) {
			fs.mkdirSync(this.projectsDir, { recursive: true })
		}
	}

	/**
	 * Parse a git URL to extract host
	 */
	private parseGitUrl(url: string): { host: string; isSSH: boolean } {
		// SSH format: git@gitlab.com:user/repo.git
		const sshMatch = url.match(/^git@([^:]+):/)
		if (sshMatch) {
			return { host: sshMatch[1], isSSH: true }
		}
		
		// HTTPS format: https://gitlab.com/user/repo.git
		const httpsMatch = url.match(/^https?:\/\/([^\/]+)\//)
		if (httpsMatch) {
			return { host: httpsMatch[1], isSSH: false }
		}
		
		return { host: "unknown", isSSH: false }
	}

	/**
	 * Build environment for git commands with authentication
	 */
	private buildGitEnv(credentialId?: string): NodeJS.ProcessEnv {
		const env = { ...process.env }
		
		if (credentialId) {
			const cred = this.credentials.getCredential(credentialId)
			if (cred) {
				this.credentials.markUsed(credentialId)
				
				if (cred.type === "ssh-key") {
					const keyPath = this.credentials.getSSHKeyPath(credentialId)
					if (keyPath) {
						// Use specific SSH key for this operation
						env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`
					}
				} else if (cred.type === "token") {
					// For HTTPS with token, we'll need to modify the URL or use credential helper
					// This is handled in the clone/pull methods
				}
			}
		}
		
		return env
	}

	/**
	 * Clone a repository to a workspace
	 */
	async cloneRepo(
		url: string,
		projectId: string,
		ref: string = "main",
		credentialId?: string
	): Promise<GitResult> {
		const repoDir = path.join(this.projectsDir, projectId)
		
		// Check if already exists
		if (fs.existsSync(repoDir)) {
			if (fs.existsSync(path.join(repoDir, ".git"))) {
				return {
					success: false,
					message: `Repository already exists at ${repoDir}. Use pull to update.`,
				}
			}
			// Directory exists but not a git repo - could be a manually created project
			// Backup and proceed
			const backupDir = `${repoDir}.backup.${Date.now()}`
			fs.renameSync(repoDir, backupDir)
			log.info(`Backed up existing directory to ${backupDir}`)
		}
		
		// Prepare environment with credentials
		const { host, isSSH } = this.parseGitUrl(url)
		const env = this.buildGitEnv(credentialId)
		
		// If using token for HTTPS, inject into URL
		let cloneUrl = url
		if (credentialId && !isSSH) {
			const cred = this.credentials.getCredential(credentialId)
			if (cred?.type === "token") {
				// Transform https://gitlab.com/user/repo.git to https://oauth2:TOKEN@gitlab.com/user/repo.git
				cloneUrl = url.replace(/^(https?:\/\/)/, `$1oauth2:${cred.secret}@`)
			}
		}
		
		try {
			log.info(`Cloning ${url} to ${repoDir} (ref: ${ref})`)
			
			// Clone
			execSync(`git clone --branch "${ref}" "${cloneUrl}" "${repoDir}"`, {
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})
			
			// Verify
			if (!fs.existsSync(path.join(repoDir, ".git"))) {
				return {
					success: false,
					message: "Clone completed but .git directory not found",
				}
			}
			
			return {
				success: true,
				message: `Successfully cloned ${url} to ${projectId} (branch: ${ref})`,
			}
		} catch (err: any) {
			log.error(`Clone failed:`, err)
			// Clean up partial clone
			if (fs.existsSync(repoDir)) {
				fs.rmSync(repoDir, { recursive: true, force: true })
			}
			return {
				success: false,
				message: `Clone failed: ${err.message}`,
				stderr: err.stderr,
			}
		}
	}

	/**
	 * Pull latest changes for a project
	 */
	async pullRepo(
		projectId: string,
		credentialId?: string
	): Promise<GitResult> {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return {
				success: false,
				message: `${projectId} is not a git repository`,
			}
		}
		
		const env = this.buildGitEnv(credentialId)
		
		try {
			// Fetch first
			execSync("git fetch --all", {
				cwd: repoDir,
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})
			
			// Get current branch
			const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			// Check for local changes
			const status = execSync("git status --porcelain", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			if (status) {
				return {
					success: false,
					message: `Cannot pull: local changes detected. Stash or commit first.`,
					stdout: status,
				}
			}
			
			// Pull
			const output = execSync(`git pull origin ${currentBranch}`, {
				cwd: repoDir,
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})
			
			return {
				success: true,
				message: `Pulled latest changes for ${projectId}`,
				stdout: output,
			}
		} catch (err: any) {
			return {
				success: false,
				message: `Pull failed: ${err.message}`,
				stderr: err.stderr,
			}
		}
	}

	/**
	 * Checkout a specific branch/ref
	 */
	async checkoutRef(
		projectId: string,
		ref: string,
		credentialId?: string
	): Promise<GitResult> {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return {
				success: false,
				message: `${projectId} is not a git repository`,
			}
		}
		
		const env = this.buildGitEnv(credentialId)
		
		try {
			// Check for local changes first
			const status = execSync("git status --porcelain", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			if (status) {
				return {
					success: false,
					message: `Cannot checkout: local changes detected. Stash or commit first.`,
					stdout: status,
				}
			}
			
			// Fetch to make sure we have the ref
			execSync("git fetch --all", {
				cwd: repoDir,
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})
			
			// Checkout
			execSync(`git checkout "${ref}"`, {
				cwd: repoDir,
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})
			
			return {
				success: true,
				message: `Checked out ${ref} in ${projectId}`,
			}
		} catch (err: any) {
			return {
				success: false,
				message: `Checkout failed: ${err.message}`,
				stderr: err.stderr,
			}
		}
	}

	/**
	 * Get current git status for a project
	 */
	getStatus(projectId: string): {
		isGitRepo: boolean
		currentRef?: string
		hasLocalChanges?: boolean
		ahead?: number
		behind?: number
		changedFiles?: string[]
	} {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return { isGitRepo: false }
		}
		
		try {
			// Get current branch
			const currentRef = execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			// Get status
			const status = execSync("git status --porcelain", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			const changedFiles = status ? status.split("\n").map(l => l.trim()) : []
			
			// Get ahead/behind
			let ahead = 0
			let behind = 0
			try {
				const comparison = execSync(`git rev-list --left-right --count origin/${currentRef}...HEAD`, {
					cwd: repoDir,
					encoding: "utf-8",
				}).trim()
				const [b, a] = comparison.split("\t").map(Number)
				behind = b
				ahead = a
			} catch {
				// Remote tracking branch might not exist
			}
			
			return {
				isGitRepo: true,
				currentRef,
				hasLocalChanges: changedFiles.length > 0,
				ahead,
				behind,
				changedFiles,
			}
		} catch (err) {
			return { isGitRepo: true }
		}
	}

	/**
	 * Create a new branch and push changes
	 */
	async createBranchAndPush(
		projectId: string,
		branchName: string,
		commitMessage: string,
		credentialId?: string
	): Promise<GitResult> {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return {
				success: false,
				message: `${projectId} is not a git repository`,
			}
		}
		
		const env = this.buildGitEnv(credentialId)
		
		try {
			// Check for changes
			const status = execSync("git status --porcelain", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			if (!status) {
				return {
					success: false,
					message: "No changes to commit",
				}
			}
			
			// Create and checkout branch
			execSync(`git checkout -b "${branchName}"`, {
				cwd: repoDir,
				encoding: "utf-8",
			})
			
			// Stage all changes
			execSync("git add -A", {
				cwd: repoDir,
				encoding: "utf-8",
			})
			
			// Commit
			execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
				cwd: repoDir,
				env: {
					...env,
					GIT_AUTHOR_NAME: "Society Agent",
					GIT_AUTHOR_EMAIL: "agent@society.local",
					GIT_COMMITTER_NAME: "Society Agent",
					GIT_COMMITTER_EMAIL: "agent@society.local",
				},
				encoding: "utf-8",
			})
			
			// Push
			execSync(`git push -u origin "${branchName}"`, {
				cwd: repoDir,
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})
			
			return {
				success: true,
				message: `Created branch ${branchName} and pushed changes`,
			}
		} catch (err: any) {
			return {
				success: false,
				message: `Failed to create branch and push: ${err.message}`,
				stderr: err.stderr,
			}
		}
	}

	/**
	 * Get list of branches for a project
	 */
	listBranches(projectId: string): { local: string[]; remote: string[] } {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return { local: [], remote: [] }
		}
		
		try {
			const local = execSync("git branch --format='%(refname:short)'", {
				cwd: repoDir,
				encoding: "utf-8",
			})
				.trim()
				.split("\n")
				.filter(Boolean)
			
			const remote = execSync("git branch -r --format='%(refname:short)'", {
				cwd: repoDir,
				encoding: "utf-8",
			})
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(b => b.replace(/^origin\//, ""))
				.filter(b => b !== "HEAD")
			
			return { local, remote }
		} catch {
			return { local: [], remote: [] }
		}
	}

	/**
	 * Generate a diff/patch of local changes
	 */
	getDiff(projectId: string): string | null {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return null
		}
		
		try {
			// Include both staged and unstaged changes
			const diff = execSync("git diff HEAD", {
				cwd: repoDir,
				encoding: "utf-8",
			})
			return diff || null
		} catch {
			return null
		}
	}

	/**
	 * Get git commit log for a project
	 */
	getLog(projectId: string, options?: { limit?: number; branch?: string }): {
		commits: Array<{
			hash: string
			shortHash: string
			author: string
			email: string
			date: string
			message: string
			subject: string
			refs?: string
		}>
		currentBranch: string | null
		error?: string
	} {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(path.join(repoDir, ".git"))) {
			return { commits: [], currentBranch: null, error: "Not a git repository" }
		}
		
		const limit = options?.limit || 50
		const branch = options?.branch || ""
		
		try {
			// Get current branch
			let currentBranch: string | null = null
			try {
				currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
					cwd: repoDir,
					encoding: "utf-8",
				}).trim()
			} catch {}
			
			// Get log with custom format
			// Format: hash|shortHash|author|email|date|refs|subject
			const format = "%H|%h|%an|%ae|%aI|%D|%s"
			const logCmd = `git log ${branch} --format="${format}" -n ${limit}`
			const logOutput = execSync(logCmd, {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()
			
			if (!logOutput) {
				return { commits: [], currentBranch }
			}
			
			const commits = logOutput.split("\n").map(line => {
				const [hash, shortHash, author, email, date, refs, subject] = line.split("|")
				return {
					hash,
					shortHash,
					author,
					email,
					date,
					message: subject, // For backwards compatibility
					subject,
					refs: refs || undefined,
				}
			})
			
			return { commits, currentBranch }
		} catch (err: any) {
			return { commits: [], currentBranch: null, error: err.message }
		}
	}

	/**
	 * Create a GitLab repository via API
	 */
	async createGitLabRepo(
		repoName: string,
		options: {
			credentialId: string
			description?: string
			visibility?: "private" | "internal" | "public"
			gitlabHost?: string
			namespace?: string // group or user namespace
		}
	): Promise<GitResult & { repoUrl?: string; webUrl?: string }> {
		const cred = this.credentials.getCredential(options.credentialId)
		if (!cred) {
			return { success: false, message: "Credential not found" }
		}
		if (cred.type !== "token") {
			return { success: false, message: "GitLab API requires a Personal Access Token, not SSH key" }
		}

		const host = options.gitlabHost || cred.host || "gitlab.com"
		// Use http for IP addresses or local hosts, https for domains
		const protocol = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host) || host.includes("localhost") ? "http" : "https"
		const apiUrl = `${protocol}://${host}/api/v4/projects`

		try {
			const body: Record<string, any> = {
				name: repoName,
				description: options.description || `Project created by Society Agent`,
				visibility: options.visibility || "private",
				initialize_with_readme: false,
			}
			
			if (options.namespace) {
				body.namespace_id = options.namespace
			}

			const response = await fetch(apiUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"PRIVATE-TOKEN": cred.secret,
				},
				body: JSON.stringify(body),
			})

			if (!response.ok) {
				const error = await response.text()
				log.error(`GitLab API error: ${response.status} ${error}`)
				return { 
					success: false, 
					message: `GitLab API error: ${response.status} - ${error}` 
				}
			}

			const data: any = await response.json()
			this.credentials.markUsed(options.credentialId)
			
			log.info(`Created GitLab repo: ${data.path_with_namespace}`)
			return {
				success: true,
				message: `Created repository: ${data.path_with_namespace}`,
				repoUrl: data.ssh_url_to_repo || data.http_url_to_repo,
				webUrl: data.web_url,
			}
		} catch (err: any) {
			log.error(`Failed to create GitLab repo:`, err)
			return { success: false, message: `Failed to create repo: ${err.message}` }
		}
	}

	/**
	 * Get an existing GitLab repository by path
	 */
	async getGitLabRepo(
		repoPath: string, // e.g., "john/architect" or just "architect" for personal namespace
		options: {
			credentialId: string
			gitlabHost?: string
		}
	): Promise<GitResult & { repoUrl?: string; webUrl?: string; exists?: boolean }> {
		const cred = this.credentials.getCredential(options.credentialId)
		if (!cred) {
			return { success: false, message: "Credential not found" }
		}
		if (cred.type !== "token") {
			return { success: false, message: "GitLab API requires a Personal Access Token" }
		}

		const host = options.gitlabHost || cred.host || "gitlab.com"
		const protocol = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host) || host.includes("localhost") ? "http" : "https"
		const encodedPath = encodeURIComponent(repoPath)
		const apiUrl = `${protocol}://${host}/api/v4/projects/${encodedPath}`

		try {
			const response = await fetch(apiUrl, {
				method: "GET",
				headers: {
					"PRIVATE-TOKEN": cred.secret,
				},
			})

			if (response.status === 404) {
				return { success: true, exists: false, message: "Repository not found" }
			}

			if (!response.ok) {
				const error = await response.text()
				return { success: false, message: `GitLab API error: ${response.status} - ${error}` }
			}

			const data: any = await response.json()
			return {
				success: true,
				exists: true,
				message: `Found repository: ${data.path_with_namespace}`,
				repoUrl: data.ssh_url_to_repo || data.http_url_to_repo,
				webUrl: data.web_url,
			}
		} catch (err: any) {
			log.error(`Failed to get GitLab repo:`, err)
			return { success: false, message: `Failed to get repo: ${err.message}` }
		}
	}

	/**
	 * Initialize a local project as a git repo and push to remote
	 */
	async initAndPushToRemote(
		projectId: string,
		repoUrl: string,
		options: {
			credentialId?: string
			commitMessage?: string
			branch?: string
		} = {}
	): Promise<GitResult> {
		const repoDir = path.join(this.projectsDir, projectId)
		
		if (!fs.existsSync(repoDir)) {
			return { success: false, message: `Project folder not found: ${repoDir}` }
		}

		const branch = options.branch || "main"
		const commitMessage = options.commitMessage || "Initial commit from Society Agent"
		const env = this.buildGitEnv(options.credentialId)

		// If using token auth, convert SSH URL to HTTPS with token
		let pushUrl = repoUrl
		if (options.credentialId) {
			const cred = this.credentials.getCredential(options.credentialId)
			if (cred && cred.type === "token") {
				const host = cred.host || "gitlab.com"
				// Convert git@host:user/repo.git to http(s)://oauth2:token@host/user/repo.git
				if (repoUrl.startsWith("git@")) {
					const match = repoUrl.match(/git@([^:]+):(.+)/)
					if (match) {
						const protocol = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host) || host.includes("localhost") ? "http" : "https"
						pushUrl = `${protocol}://oauth2:${cred.secret}@${match[1]}/${match[2]}`
						log.info(`Converted SSH URL to HTTPS for token auth`)
					}
				} else if (repoUrl.startsWith("http")) {
					// Already HTTP(S), inject token
					pushUrl = repoUrl.replace(/^(https?:\/\/)/, `$1oauth2:${cred.secret}@`)
				}
			}
		}


		try {
			// Check if already a git repo
			const isGitRepo = fs.existsSync(path.join(repoDir, ".git"))
			
			if (!isGitRepo) {
				// Initialize git
				execSync("git init", { cwd: repoDir, encoding: "utf-8" })
				log.info(`Initialized git in ${repoDir}`)
			}

			// Configure git user if not set
			try {
				execSync("git config user.email", { cwd: repoDir, encoding: "utf-8" })
			} catch {
				execSync('git config user.email "agent@society.local"', { cwd: repoDir })
				execSync('git config user.name "Society Agent"', { cwd: repoDir })
			}

			// Create .gitignore if it doesn't exist
			const gitignorePath = path.join(repoDir, ".gitignore")
			if (!fs.existsSync(gitignorePath)) {
				fs.writeFileSync(gitignorePath, `# Society Agent
node_modules/
.env
.env.local
*.log
.DS_Store
`)
			}

			// Add all files
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8" })

			// Check if there are changes to commit
			const status = execSync("git status --porcelain", { cwd: repoDir, encoding: "utf-8" }).trim()
			
			if (status || !isGitRepo) {
				// Commit
				execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}" --allow-empty`, {
					cwd: repoDir,
					env: {
						...env,
						GIT_AUTHOR_NAME: "Society Agent",
						GIT_AUTHOR_EMAIL: "agent@society.local",
						GIT_COMMITTER_NAME: "Society Agent",
						GIT_COMMITTER_EMAIL: "agent@society.local",
					},
					encoding: "utf-8",
				})
			}

			// Check/set the branch name
			const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: repoDir,
				encoding: "utf-8",
			}).trim()

			if (currentBranch !== branch && currentBranch === "master") {
				// Rename master to main (or specified branch)
				execSync(`git branch -M ${branch}`, { cwd: repoDir, encoding: "utf-8" })
			}

			// Check if remote already exists
			let hasRemote = false
			try {
				const remotes = execSync("git remote", { cwd: repoDir, encoding: "utf-8" })
				hasRemote = remotes.includes("origin")
			} catch {}

			if (hasRemote) {
				// Update existing remote
				execSync(`git remote set-url origin "${pushUrl}"`, { cwd: repoDir, encoding: "utf-8" })
			} else {
				// Add remote
				execSync(`git remote add origin "${pushUrl}"`, { cwd: repoDir, encoding: "utf-8" })
			}

			// Push
			execSync(`git push -u origin ${branch}`, {
				cwd: repoDir,
				env,
				stdio: "pipe",
				encoding: "utf-8",
			})

			// Reset remote URL to clean version (without embedded token) for security
			// The token was only needed for the push operation
			if (pushUrl !== repoUrl) {
				// Convert back to SSH URL or clean HTTP URL
				const cleanUrl = repoUrl.startsWith("git@") ? repoUrl : repoUrl.replace(/oauth2:[^@]+@/, "")
				execSync(`git remote set-url origin "${cleanUrl}"`, { cwd: repoDir, encoding: "utf-8" })
				log.info(`Reset remote URL to clean version (token removed)`)
			}

			log.info(`Pushed ${projectId} to ${repoUrl}`)
			return {
				success: true,
				message: `Successfully pushed ${projectId} to ${repoUrl} (branch: ${branch})`,
			}
		} catch (err: any) {
			log.error(`Failed to init and push:`, err)
			return {
				success: false,
				message: `Failed to push: ${err.message}`,
				stderr: err.stderr,
			}
		}
	}

	/**
	 * Get GitLab namespaces (groups and user) available to the token
	 */
	async getGitLabNamespaces(credentialId: string): Promise<{ id: number; name: string; path: string; full_path: string; kind: string }[]> {
		const cred = this.credentials.getCredential(credentialId)
		if (!cred || cred.type !== "token") {
			return []
		}

		const host = cred.host || "gitlab.com"
		// Use http for IP addresses or local hosts, https for domains
		const protocol = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host) || host.includes("localhost") ? "http" : "https"
		
		try {
			const response = await fetch(`${protocol}://${host}/api/v4/namespaces`, {
				headers: { "PRIVATE-TOKEN": cred.secret },
			})
			
			if (!response.ok) return []
			
			const data = await response.json() as any[]
			return data.map((ns: any) => ({
				id: ns.id,
				name: ns.name,
				path: ns.path,
				full_path: ns.full_path || ns.path,
				kind: ns.kind, // "user" or "group"
			}))
		} catch {
			return []
		}
	}
}

// ==============================================================================
// Singleton instances (can be initialized later with actual workspace path)
// ==============================================================================

let _credentialsStore: CredentialsStore | null = null
let _gitLoader: GitLoader | null = null

export function initGitLoader(workspacePath: string): GitLoader {
	if (!_credentialsStore) {
		_credentialsStore = new CredentialsStore(workspacePath)
	}
	if (!_gitLoader) {
		_gitLoader = new GitLoader(workspacePath, _credentialsStore)
	}
	return _gitLoader
}

export function getGitLoader(): GitLoader | null {
	return _gitLoader
}

export function getCredentialsStore(): CredentialsStore | null {
	return _credentialsStore
}

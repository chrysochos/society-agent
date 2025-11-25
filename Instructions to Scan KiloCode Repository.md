# Instructions for an AI Agent to Scan the KiloCode Repository

These instructions are designed for a local AI Agent (CLI or VS Code) to systematically scan the **KiloCode** repository placed on your computer. The goal is to map out how the CLI and VS Code extension work internally and identify integration points for transforming the system into a **Society Agent**.

You may copy-paste this entire document as a prompt into any Agent once the repo is placed on your machine.

---

# IMPORTANT NOTE ABOUT GENERATED ANALYSIS FILES

The following files in this folder were **created by us** (the human + supervising agent workflow) and **are NOT part of the original KiloCode repository**:

* `SOCIETY_AGENT_ANALYSIS_OVERVIEW.md`
* `SOCIETY_AGENT_FOLDER_STRUCTURE.md`
* `SOCIETY_AGENT_EXECUTION_FLOWS.md`
* `SOCIETY_AGENT_INJECTION_POINTS.md`
* `SOCIETY_AGENT_MODIFICATION_PLAN.md`

These files were produced **after scanning the KiloCode repo** and should **not** be interpreted by Agents as belonging to the repo itself. They are analysis artifacts.

You may reference them during future analysis, but you must not treat them as original repository files.

---

# 1. Repository Location

The repository will be located at:

```
/path/to/kilocode/
```

(Replace with the actual path before running the scan.)

---

# 2. Folders to Analyze

Scan the following two major components:

## **A. CLI Agent**

Located in:

```
/kilocode/cli/
/kilocode/cli/src
/kilocode/cli/lib
```

Look for:

* CLI entry point
* Input parsing
* Model invocation
* Output formatting
* File system interactions
* Config loading
* Error handling
* Diff/patch generation
* Helper utilities
* Ideal spots for middleware injection

## **B. VS Code Extension**

Located in:

```
/kilocode/vscode/
/kilocode/vscode/src
/kilocode/vscode/out
```

Look for:

* Extension activation logic
* How tasks are sent to CLI
* child_process usage
* stdout/stderr parsing
* Command definitions
* File editing handlers
* UI panels or status integration

---

# 3. What the Agent Must Extract From the Repo

The Agent should produce a detailed mapping of each component.

## **A. CLI Mapping**

Extract:

* Entry point file(s)
* Argument parser
* Execution flow (input → model → output)
* Model call functions
* Output parsing functions
* File read/write functions
* Error and exception handlers
* Helper modules and utilities
* Middleware injection points

## **B. VS Code Extension Mapping**

Extract:

* Activation file (`extension.ts` or similar)
* Command registration
* VS Code → CLI call mechanism
* CLI output parsing
* Patch/diff application logic
* File editing utilities
* UI components (views, panels)
* Where metadata or Supervisor channel can be added

---

# 4. Critical Middleware Injection Points

While scanning, highlight the places where we can insert:

### **1. Input Middleware**

* Task normalization
* PECP-lite enforcement
* Attach role/domain metadata

### **2. Output Middleware**

* Output cleaning
* Structured message enforcement
* Result packaging

### **3. Permission Layer**

* Intercept write operations
* Restrict edits to assigned domain
* Require Supervisor approval for risk actions

### **4. Supervisor Communication Layer**

* WebSocket or HTTP client creation
* Where results, alerts, and metadata are sent
* How to attach logs or telemetry

### **5. Identity and Capability Injection**

* Attach Agent identity
* Inject domain, role, capability metadata

### **6. Injection History Storage**

* Local file for logs
* Memory module for state persistence

### **7. VS Code Bridging**

* Points where extension sends tasks to CLI
* Locations where we intercept or rewrite messages

---

# 5. Required Output From the Agent

After scanning, the Agent must produce:

## **1. Folder Map**

A clear file-by-file breakdown:

```
- cli/
   - file1: purpose
   - file2: purpose
- vscode/
   - extension.ts: purpose
   - actions.ts: purpose
```

## **2. CLI Pipeline Diagram**

Describe the exact flow:

```
input → parse → model call → parse output → modify files → stdout
```

With file and function references.

## **3. VS Code Integration Diagram**

```
VS Code command → extension logic → spawn CLI → parse response → apply edits
```

Include functions and file paths.

## **4. List of Injection Points**

For each, specify:

* File name
* Function name
* Responsibility
* Suggested modification

## **5. Recommended Modification Plan**

Step-by-step plan, e.g.:

* Add middleware wrapper in CLI
* Intercept model calls
* Enforce structured outputs
* Add Supervisor channel
* Patch VS Code extension call path
* Add metadata UI panel

---

# 6. Constraints for the Agent

* Do NOT modify files automatically unless instructed.
* Do NOT run untrusted commands.
* Prefer static analysis.
* Output findings clearly and in structured form.

---

# 7. Cross-Reference With AGENTS.md

If an `AGENTS.md` file exists in the same folder, you must read it **before scanning**.
Use it to:

* Identify which files were created by humans/agents (analysis artifacts).
* Avoid treating any `SOCIETY_AGENT_*.md` file as part of the real repository.
* Place new analysis outputs only in the directories that `AGENTS.md` designates.
* Follow any safety or behavior rules defined there.

---

# 8. Final Instruction

Begin scanning only when I say:

```
Begin scan
```

At that moment, perform the full analysis described above.

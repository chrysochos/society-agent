# GitHub Public Release - Cleanup Checklist

**Date**: February 6, 2026  
**Purpose**: Prepare Society Agent for public GitHub release  
**Current Status**: Private GitLab → Public GitHub

---

## ✅ Already Protected (Safe)

These are already in `.gitignore` and won't be pushed:

- `.env` files (API keys, secrets)
- `node_modules/`
- `dist/`, `out/`, `bin/`
- `.DS_Store`, `*.orig`
- `/local-prompts`
- `.pnpm-store`

---

## 🔍 Items to Review Before Push

### 1. **Environment Files** ✅

- [x] `.env` - Already in .gitignore
- [x] `.env.example` - Safe (example only, no real credentials)
- [x] `.env.sample` - Safe (sample only)

### 2. **Documentation Files to Clean**

Review these files for internal/private information:

#### Society Agent Documentation

- [ ] `SOCIETY_AGENT_SETUP.md` - Contains example API key format (line 12, 30)
    - **Action**: Replace `sk-ant-api03-your-actual-key-here` with `your-api-key-here`
- [ ] `LINKEDIN_PRESENTATION_SIMPLE.md` - Examples are fine, but review

    - Contains example password discussions (educational context - OK)

- [ ] `greeting_response.txt` - Check if this is internal only
- [ ] `clarifying_questions.txt` - Check if this is internal only

#### Analysis Documents

These look like development artifacts - decide if they should be public:

- [ ] `api_interface_specs.md`
- [ ] `capabilities_detailed.md`
- [ ] `comparison_matrix.json`
- [ ] `deployment_architecture.md`
- [ ] `intent_analysis.md`
- [ ] `limitations_and_constraints.md`
- [ ] `model_overview.md`
- [ ] `next_steps.md`
- [ ] `performance_benchmarks.json`
- [ ] `suggested_responses.json`
- [ ] `technical_specifications.json`
- [ ] `training_methodology.md`
- [ ] `use_case_examples.md`

**Recommendation**: Either delete these or move to a `/docs/` or `/analysis/` folder with a note that they're internal

### 3. **Code Files to Review**

- [ ] Check for commented-out code with internal notes
- [ ] Look for TODO/FIXME with internal references
- [ ] Review any test files for sensitive data

### 4. **Git History**

- [ ] Review recent commits for sensitive commit messages
- [ ] Check if any secrets were accidentally committed previously
    ```bash
    git log --all --full-history -- "*.env"
    ```

---

## 🧹 Recommended Actions

### Option 1: Clean Before Push (Recommended)

1. **Remove Internal Analysis Files**:

    ```bash
    # Create a backup first
    mkdir ../society-agent-backup
    cp -r . ../society-agent-backup/

    # Remove internal files
    git rm greeting_response.txt clarifying_questions.txt
    git rm intent_analysis.md suggested_responses.json
    # Add more as needed
    ```

2. **Sanitize API Key Examples**:

    - Edit `SOCIETY_AGENT_SETUP.md` to use generic placeholders

3. **Add Note to README**:

    - Mention this is an alpha release
    - Link to sanitized docs only

4. **Commit cleanup**:
    ```bash
    git add .
    git commit -m "chore: sanitize for public GitHub release"
    ```

### Option 2: Fork and Clean (Safest)

1. **Create a new clean branch**:

    ```bash
    git checkout -b github-public
    ```

2. **Remove all sensitive/internal files**:

    ```bash
    # Remove development artifacts
    rm greeting_response.txt clarifying_questions.txt
    rm intent_analysis.md suggested_responses.json
    rm comparison_matrix.json performance_benchmarks.json
    rm technical_specifications.json
    # etc.
    ```

3. **Clean documentation**:

    - Keep main docs: SOCIETY_AGENT_README.md, AGENTS.md, etc.
    - Remove or sanitize: SOCIETY_AGENT_SETUP.md API key examples

4. **Commit and push to new GitHub repo**:
    ```bash
    git add .
    git commit -m "chore: prepare for public release"
    # Push to new GitHub repo (not origin)
    ```

---

## 📋 Specific File Actions

### Files to Definitely Keep (Public)

✅ All `SOCIETY_AGENT_*.md` documentation  
✅ `AGENTS.md`  
✅ `README.md`  
✅ `CHANGELOG.md`  
✅ `CONTRIBUTING.md`  
✅ `LICENSE`, `NOTICE`  
✅ `PRIVACY.md`, `CODE_OF_CONDUCT.md`  
✅ All source code in `src/`, `cli/`, `webview-ui/`

### Files to Review/Clean

⚠️ `SOCIETY_AGENT_SETUP.md` - Sanitize API key examples  
⚠️ `LINKEDIN_PRESENTATION_SIMPLE.md` - Review for internal notes  
⚠️ All `/analysis/*.md` files if they exist

### Files to Remove (Internal Only)

❌ `greeting_response.txt`  
❌ `clarifying_questions.txt`  
❌ `intent_analysis.md`  
❌ `suggested_responses.json`  
❌ `comparison_matrix.json`  
❌ `performance_benchmarks.json`  
❌ `technical_specifications.json`  
❌ Any internal meeting notes or private discussions

---

## 🔒 Final Security Check

Before pushing to public GitHub:

```bash
# 1. Check for secrets in files
grep -r "password\|secret\|token\|api_key" --include="*.md" --include="*.ts" --include="*.json" .

# 2. Check git history for accidentally committed secrets
git log --all --full-history --source -- "**/.env*"

# 3. Scan with git-secrets (if installed)
# git secrets --scan

# 4. Review all tracked files
git ls-files

# 5. Check what will be pushed
git diff origin/society-agent-fresh..HEAD --stat
```

---

## 📤 Push Commands (After Cleanup)

### To New Public GitHub Repo

```bash
# Add new GitHub remote
git remote add github https://github.com/Kilo-Org/kilocode.git

# Push cleaned branch
git push github society-agent-fresh

# Or push to main if ready
git checkout main
git merge society-agent-fresh
git push github main
```

### To Existing Repo

```bash
# Just push (after cleanup)
git push origin society-agent-fresh
```

---

## ⚠️ Important Notes

1. **Once pushed to public GitHub, it's permanent** - even if you delete it later, it may be cached/forked
2. **Review EVERYTHING** - better to be over-cautious
3. **Keep GitLab private** as your master source with all internal notes
4. **Use GitHub** as the public-facing sanitized version
5. **Consider different branches** - `main` for public, `internal` for GitLab

---

## ✅ Final Checklist Before Push

- [ ] All `.env` files are in `.gitignore`
- [ ] No real API keys or credentials in code or docs
- [ ] Internal analysis files removed or sanitized
- [ ] API key examples use generic placeholders
- [ ] Commit messages don't contain sensitive info
- [ ] Git history reviewed for accidental secrets
- [ ] README updated with public information only
- [ ] All team members reviewed and approved
- [ ] Backup created of full private version
- [ ] Ready to push to public GitHub! 🚀

---

**Created**: February 6, 2026  
**Status**: Ready for review and cleanup

---
name: compile-latex
description: Compile LaTeX document with BibTeX bibliography to PDF
version: 1.1
triggers:
  - /compile-latex
  - compile latex
  - build pdf
  - pdflatex
  - generate document
parameters:
  file:
    type: string
    description: Path to the .tex file (default: main.tex)
    required: false
    default: main.tex
---

# Compile LaTeX with Bibliography

Compiles a LaTeX document that uses BibTeX for bibliography/citations into a PDF.

## Prerequisites

- `pdflatex` installed (texlive)
- `bibtex` installed (texlive)
- `.tex` file with `\bibliography{references}` or similar
- `.bib` file with citation entries

## Instructions

Execute these commands in sequence:

```bash
# 1. Navigate to document directory
cd /path/to/document/

# 2. First pdflatex pass - creates .aux file
pdflatex -interaction=nonstopmode {{file}} 2>&1

# 3. Process bibliography
bibtex {{file | replace: '.tex', ''}} 2>&1

# 4. Second pdflatex pass
pdflatex -interaction=nonstopmode {{file}} 2>&1

# 5. Third pdflatex pass
pdflatex -interaction=nonstopmode {{file}} 2>&1
```

**IMPORTANT:** Use `-interaction=nonstopmode` to prevent LaTeX from waiting for input on errors.

---

## Verification & Debugging (CRITICAL!)

### After EACH pdflatex run:
1. **Check command output** for errors starting with `!` (LaTeX error prefix)
2. **If "!" errors exist** → read the .log file for details
3. **Common output patterns:**
   - `! LaTeX Error:` → Syntax error in .tex file
   - `! Undefined control sequence` → Missing package or typo
   - `Output written on file.pdf` → Success!

### After ALL steps complete:
```bash
# Verify PDF was created and has content
ls -la {{file | replace: '.tex', '.pdf'}}

# If PDF is tiny (<1KB), compilation failed. Check log:
tail -100 {{file | replace: '.tex', '.log'}} | grep -A5 "^!"
```

### If compilation fails:
1. **Read the log file**: `tail -100 {{file}}.log`
2. **Look for `!` lines** - these are the actual errors
3. **Fix the error in the .tex file**
4. **Re-run the FULL compilation sequence**

---

## Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `! Missing \begin{document}` | No `\begin{document}` before content | Add `\begin{document}` after preamble |
| `! LaTeX Error: Missing \begin{document}` | Corrupted backslash (`\b\begin`) | Fix escape sequences (see below) |
| `! Undefined control sequence` | Missing package or typo | Check package imports or fix command name |
| `! Lonely \item` | `\item` outside list environment | Check for `s\item` → `stem` corruption |
| Citation `[?]` | BibTeX didn't run or keys mismatch | Run bibtex, verify citation keys exist in .bib |

---

## AI LaTeX Corruption Patterns

When AI writes LaTeX files, JSON encoding can corrupt backslashes:

| Corrupted | Should Be | Cause |
|-----------|-----------|-------|
| `\b\begin` | `\begin` | `\b` = backspace in JSON |
| `\t\textbf` | `\textbf` | `\t` = tab in JSON |
| `\n\newline` | `\newline` | `\n` = newline in JSON |
| `\r\ref` | `\ref` | `\r` = carriage return in JSON |
| `\\section` | `\section` | Double-escaped backslash |
| `s\item` | `stem` | `\i` = special char in JSON |
| `\e\end` | `\end` | `\e` = escape in some contexts |

### Fix corruption with sed:
```bash
sed -i 's/\\b\\begin/\\begin/g; s/\\t\\textbf/\\textbf/g; s/\\r\\ref/\\ref/g; s/\\e\\end/\\end/g; s/\\n\\newline/\\newline/g; s/s\\item/stem/g' {{file}}
```

---

## Complete Example Workflow

```bash
# 1. Change to document directory
cd /path/to/document

# 2. Check for corruption before compiling
grep -E '\\b\\begin|\\t\\textbf|s\\item' main.tex && echo "CORRUPTION DETECTED - fix first!"

# 3. Compile with error capturing
pdflatex -interaction=nonstopmode main.tex 2>&1 | tee /tmp/latex1.log

# 4. Check for errors
grep "^!" /tmp/latex1.log && echo "ERRORS FOUND - check log"

# 5. If no errors, continue with bibtex
bibtex main 2>&1

# 6. Second pass
pdflatex -interaction=nonstopmode main.tex 2>&1

# 7. Third pass
pdflatex -interaction=nonstopmode main.tex 2>&1

# 8. Verify result
ls -la main.pdf
file main.pdf
```

---

## Notes

- Always run the full 4-step sequence when citations change
- Running pdflatex once is insufficient for bibliography
- Keep .bib file in same directory or specify path
- Use `-interaction=nonstopmode` to see errors without hanging

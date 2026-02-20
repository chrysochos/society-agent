#!/bin/bash
# Compile LaTeX document with BibTeX bibliography
# Usage: ./script.sh [file.tex]

set -e

FILE="${1:-main.tex}"
BASE="${FILE%.tex}"

echo "=== Compiling $FILE ==="

# First pdflatex pass
echo "Step 1/4: First pdflatex pass..."
pdflatex -interaction=nonstopmode "$FILE" || true

# BibTeX pass
echo "Step 2/4: Running bibtex..."
bibtex "$BASE" || true

# Second pdflatex pass
echo "Step 3/4: Second pdflatex pass..."
pdflatex -interaction=nonstopmode "$FILE" || true

# Third pdflatex pass
echo "Step 4/4: Third pdflatex pass..."
pdflatex -interaction=nonstopmode "$FILE"

echo "=== Done: ${BASE}.pdf ==="
ls -la "${BASE}.pdf"

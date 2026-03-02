FROM node:20-slim

# Install system dependencies permanently in the image
RUN apt-get update && apt-get install -y \
    git curl wget jq sqlite3 \
    iputils-ping net-tools dnsutils \
    python3 python3-pip python3-venv \
    build-essential make g++ \
    texlive-latex-base texlive-latex-extra texlive-pictures \
    texlive-fonts-extra texlive-fonts-recommended latexmk \
    librsvg2-bin \
    # Playwright browser dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm deps permanently in the image
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Install Playwright browsers
RUN npx -y playwright install chromium

# Copy your source permanently into the image
COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
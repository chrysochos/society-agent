FROM node:20-slim

# Install common tools agents might need + build tools for native modules (node-pty)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

EXPOSE 4000

CMD ["npm", "start"]

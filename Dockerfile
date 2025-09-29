# Stage 1: Builder
FROM node:18-alpine AS builder
WORKDIR /app

# Copy dependency files first (better caching)
COPY package*.json ./

# Install dependencies (this layer will be cached if deps don't change)
RUN npm ci

# Copy source code (this invalidates cache only when code changes)
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production
FROM node:18-alpine
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache python3 py3-pip build-base g++ libgomp

# Copy dependency files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Install Python dependencies (fix the Python error)
COPY src/python/requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY src/python/*.py ./dist/python/

EXPOSE 3000
CMD ["node", "dist/index.js"]
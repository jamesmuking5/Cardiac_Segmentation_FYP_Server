# Stage 1: Builder
FROM node:18-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the application
RUN npm run build

# Optional: Prune devDependencies if you want to copy node_modules later
# RUN npm prune --production

# Stage 2: Final image
FROM node:18-alpine
WORKDIR /app

# Set environment variable for production
ENV REDIS_HOST=redis-node-f5u69g.serverless.use1.cache.amazonaws.com

# Copy package files again for production install
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy built application from the builder stage
COPY --from=builder /app/dist ./dist

# Optional: If you pruned in the builder stage, copy node_modules
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

# Use node directly to run the app
CMD [ "node", "dist/index.js" ]
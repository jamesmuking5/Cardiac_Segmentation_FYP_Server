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

# Install Python and its dependencies (no --no-cache on initial apk add, better to prune later)
RUN apk add python3 py3-pip \
    build-base \
    g++ \
    libgomp \
    # Clean up apk cache immediately to reduce layer size
    && rm -rf /var/cache/apk/*

# Copy package files again for production install
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy built application from the builder stage
COPY --from=builder /app/dist ./dist

# Copy public assets from the builder stage
COPY --from=builder /app/public ./public

# Copy Node.js node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Create a directory for Python scripts inside the /app directory
RUN mkdir -p /app/dist/python

# Copy the Python scripts
COPY src/python/extract_metadata.py /app/dist/python/
COPY src/python/convert_to_jpeg.py /app/dist/python/
COPY src/python/create_nifti_from_segmentations.py /app/dist/python/

# Install Python dependencies for your scripts in a virtual environment
COPY src/python/requirements.txt /app/dist/python/
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /app/dist/python/requirements.txt

# Activate the virtual environment for subsequent commands
# This ensures that when Node.js calls 'python3', it uses the one from the venv
ENV PATH="/opt/venv/bin:$PATH"

EXPOSE 3000

# Use node directly to run the app
CMD [ "node", "dist/index.js" ]
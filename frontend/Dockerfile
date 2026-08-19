FROM node:22-bullseye-slim

# Set the working directory in the container
WORKDIR /app

# The repo is on pnpm (package.json "packageManager": pnpm@10.32.1, and the
# lockfile is pnpm-lock.yaml). Corepack ships with Node 22 and installs the
# exact pinned version, so the image can never drift from the lockfile.
# The download prompt has no TTY to answer it during a build.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Copy the manifest and lockfile first so the dependency layer caches
# independently of source edits.
COPY package.json pnpm-lock.yaml /app/

# Set the environment variable to skip Puppeteer download
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the current directory contents into the container at /app
COPY ./ /app/

# Expose port 5173 to access the server
EXPOSE 5173

# Command to run the application
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

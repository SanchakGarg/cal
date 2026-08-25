# One image: builds the web app, runs the API, and serves the static bundle.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install
COPY . .
RUN npm run build -w web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SERVE_WEB=true
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install --omit=dev -w server && npm cache clean --force
COPY db ./db
COPY docs ./docs
COPY server/src ./server/src
COPY server/tsconfig.json ./server/tsconfig.json
COPY --from=build /app/web/dist ./web/dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3001
# The entrypoint migrates before serving, so `docker compose up -d` is enough.
CMD ["./docker-entrypoint.sh"]

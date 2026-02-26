FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY site ./site
EXPOSE 8080
CMD ["node", "dist/server.js"]

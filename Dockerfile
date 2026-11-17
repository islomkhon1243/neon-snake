FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/snake.sqlite
COPY package.json server.mjs ./
COPY dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
EXPOSE 3000
CMD ["node", "server.mjs"]

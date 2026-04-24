FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json .
COPY server.js .

EXPOSE 3010
CMD ["node", "server.js"]

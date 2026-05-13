FROM node:20-slim

WORKDIR /app

# Copy package files
COPY chatbot-service/package*.json ./
RUN npm install

# Copy source code
COPY chatbot-service/ .

# We load .env from the root in the code, but we can also pass env vars via Docker
# The server.js has: dotenv.config({ path: join(__dirname, '..', '.env') });
# To make this work in a container where '..' might be different, we'll adjust the path or copy the .env

EXPOSE 5010

CMD ["node", "server.js"]

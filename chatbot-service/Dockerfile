FROM node:20-slim

WORKDIR /app

# Copy package files
COPY chatbot-service/package*.json ./
RUN npm install

# Copy source code
COPY chatbot-service/ .

EXPOSE 5010

CMD ["node", "server.js"]

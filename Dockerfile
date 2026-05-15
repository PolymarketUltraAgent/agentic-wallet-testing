FROM node:22-slim

WORKDIR /app

RUN npm install -g @circle-fin/cli

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data/sessions

ENV NODE_ENV=production
ENV SESSION_DIR=/app/data/sessions
ENV DATABASE_URL=/app/data/bot.sqlite
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]

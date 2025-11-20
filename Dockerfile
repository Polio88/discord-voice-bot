
FROM node:18-alpine

# Instala herramientas para compilar dependencias nativas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["npm", "start"]

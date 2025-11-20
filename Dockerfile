
# Usa una imagen ligera de Node
FROM node:18-alpine

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala dependencias (solo producción)
RUN npm install --omit=dev

# Copia el resto del código
COPY . .

# Comando para arrancar el bot

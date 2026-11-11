FROM php:8.3-cli
RUN apt-get update && apt-get install -y libsqlite3-dev libcurl4-openssl-dev && docker-php-ext-install pdo_sqlite curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "-t", "/app"]

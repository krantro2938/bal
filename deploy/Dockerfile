# Multi-stage build: frontend (Node) → Go binary → small runtime image.
FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.27-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/bal ./cmd/bal

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata ffmpeg && adduser -D -H -u 10001 bal
WORKDIR /app
COPY --from=api /out/bal /app/bal
COPY --from=web /src/web/dist /app/web
COPY content/ /app/content/
ENV BAL_ADDR=0.0.0.0:8080 \
    BAL_STATIC_DIR=/app/web \
    BAL_SOURCES=/app/content/sources.json \
    BAL_MEDIA_DIR=/data/media \
    BAL_RAW_DIR=/data/raw \
    BAL_DB=/data/db/bal.db
USER bal
EXPOSE 8080
VOLUME ["/data/media", "/data/db"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/app/bal"]
CMD ["serve"]

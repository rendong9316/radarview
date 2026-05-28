# RadarView Cloud

Web-based 3D Aircraft Track Viewer - Migrated from Tauri desktop to SpringBoot microservices.

## Architecture

```
                            ┌─────────────┐
                            │   Browser   │
                            │ Vue 3 + CesiumJS │
                            └──────┬──────┘
                                   │ HTTP/WS
                            ┌──────▼──────┐
                            │   Gateway   │ (8080)
                            │ Spring Cloud│
                            │   Gateway   │
                            └──┬──┬──┬──┬─┘
                               │  │  │  │
              ┌────────────────┘  │  │  └────────────────┐
              ▼                   ▼  ▼                    ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │ Auth Service│    │Track Service│    │Tile Service │
    │   (8081)    │    │   (8082)    │    │   (8084)    │
    └──────┬──────┘    └──┬───┬──────┘    └──────┬──────┘
           │              │   │                  │
           ▼              │   ▼                  ▼
      ┌─────────┐         │  RabbitMQ     ┌──────────┐
      │  MySQL  │         │               │ MBTiles  │
      │ (Auth)  │         │               │ (SQLite) │
      └─────────┘         ▼               └──────────┘
                    ┌──────────────┐
                    │Import Worker │ ────┐
                    │   (8083)     │     │
                    └──────────────┘     │
                           │             │
                           ▼             ▼
                    ┌──────────┐  ┌──────────────┐
                    │  MySQL   │  │Notification  │
                    │ (Track)  │  │  Service     │
                    └──────────┘  │  (8085) WS   │
                                  └──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Framework | Spring Boot 3.2 + Spring Cloud 2023 |
| Service Discovery | Nacos |
| API Gateway | Spring Cloud Gateway |
| Database | MySQL 8.0 (normalized schema) |
| Cache | Redis 7 |
| Message Queue | RabbitMQ 3.13 |
| ORM | MyBatis-Plus 3.5 |
| Auth | Spring Security + JWT (HMAC-SHA256) |
| Distributed Lock | Redisson |
| Rate Limiting | Sentinel + Gateway RateLimiter |
| Monitoring | Prometheus + Micrometer |
| Tracing | SkyWalking agent |
| Frontend | Vue 3 + CesiumJS + Pinia + Vue Router |
| Container | Docker + Kubernetes |

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d mysql redis rabbitmq nacos

# 2. Build all services
mvn clean package -DskipTests

# 3. Start all services
docker compose up -d

# 4. Start frontend dev server
cd frontend && npm install && npm run dev

# 5. Open browser
# Frontend: http://localhost:5173
# Default login: admin / admin123
```

## Service Ports

| Service | Port |
|---------|------|
| Gateway | 8080 |
| Auth Service | 8081 |
| Track Service | 8082 |
| Import Worker | 8083 |
| Tile Service | 8084 |
| Notification Service | 8085 |
| Frontend (dev) | 5173 |
| Nacos Dashboard | 8848 |
| RabbitMQ Management | 15672 |

## Project Structure

```
radarview-cloud/
├── pom.xml                     # Root POM
├── docker-compose.yml          # Dev environment
├── Dockerfile.*                # Per-service Dockerfiles
├── sql/                        # Database migration scripts
│   ├── V1__auth_schema.sql
│   ├── V2__track_schema.sql
│   └── V3__migrate_sqlite_to_mysql.sql
├── k8s/                        # Kubernetes manifests
│   ├── namespace.yaml
│   ├── ingress.yaml
│   ├── config/                 # Secrets, ConfigMaps, PVCs
│   ├── mysql/ redis/ rabbitmq/ # Infrastructure deployments
│   └── services/               # App service deployments
├── radarview-common/           # Shared DTOs, enums, exception, audit
├── radarview-gateway/          # API Gateway
├── radarview-auth/             # Auth Service
├── radarview-track/            # Track Service
├── radarview-import-worker/    # Async Import Worker
├── radarview-tile/             # Tile Service
├── radarview-notification/     # WebSocket Notification Service
└── frontend/                   # Vue 3 + CesiumJS
    ├── src/api/                # Axios API layer
    ├── src/stores/             # Pinia stores
    ├── src/router/             # Vue Router
    └── src/views/              # LoginView, MapView
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/auth/login | Login |
| POST | /api/v1/auth/register | Register |
| POST | /api/v1/auth/refresh | Refresh token |
| POST | /api/v1/auth/logout | Logout |
| GET | /api/v1/auth/me | Current user info |

### Tracks
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/tracks/import/adsb | Import ADS-B CSV |
| POST | /api/v1/tracks/import/radar | Import radar MAT |
| POST | /api/v1/tracks/import/radar-raw | Import radar raw |
| GET | /api/v1/tracks | All tracks |
| GET | /api/v1/tracks/batch/{id} | Tracks by batch |
| GET | /api/v1/batches | List batches |
| DELETE | /api/v1/batches/{id} | Delete batch |

### Tiles
| Method | Path | Description |
|--------|------|-------------|
| GET | /tiles/{z}/{x}/{y}.png | Map tile |

### WebSocket
| Path | Description |
|------|-------------|
| /ws/notifications | STOMP endpoint for import progress |

## Production Deployment

```bash
# Build and push Docker images
docker build -t radarview-gateway:1.0.0 -f Dockerfile.gateway .
# ... (repeat for each service)

# Deploy to Kubernetes
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/config/
kubectl apply -f k8s/mysql/
kubectl apply -f k8s/redis/
kubectl apply -f k8s/rabbitmq/
kubectl apply -f k8s/services/
kubectl apply -f k8s/ingress.yaml
```

# SYSTEM DESCRIPTION:

The project is a distributed, fault-tolerant seismic analysis platform.

Its purpose is to ingest live seismic measurements from an external simulator, redistribute them through a custom broker, process them through replicated analysis nodes, classify suspicious seismic activity through frequency analysis, persist sensor metadata and detected events through the gateway in a duplicate-safe way, and expose both live and historical information through a real-time dashboard.

The implemented system is based on the following architectural principles:

- a custom broker that only captures and redistributes measurements
- multiple identical processing replicas
    - sliding-window analysis on each replica
    - FFT-based frequency detection
- a single gateway exposed to the frontend
    - duplicate-safe persistence to PostgreSQL after gateway-side deduplication
- a dashboard for real-time monitoring, historical investigation, and replica health
- full deployment through `docker compose up`

Relevant LoFi mockups are available in `booklets/mockup/` and cover the main dashboard views: Sensors, Historical Events, Event Details, and System Health.

The deployed topology is defined in `source/docker-compose.yml`.

# USER STORIES:

1) As an Operator, I want to see all available seismic sensors in the dashboard, so that I can understand which sources are monitored by the platform.
2) As an Operator, I want to see the category of each sensor, so that I can distinguish field sensors from datacenter sensors.
3) As an Operator, I want to see the region and coordinates of each sensor, so that I can understand the geographic context of the monitored network.
4) As an Operator, I want to know whether the real-time measurements are online or not, so that I can easily see if the data I am seeing is recent or stale.
5) As an Operator, I want to see the last detected event of each sensor, so that I can react quickly to suspicious activity.
6) As an Operator, I want to see the last dominant frequency detected for each sensor, so that I can evaluate the gravity of the event.
7) As an Operator, I want to open the details of a detected event, so that I can inspect sensor, timestamps, frequency, and classification in one place.
8) As an Operator, I want to see the peak amplitude of each detected event, so that I can estimate how strong the seismic wave was.
9) As an Operator, I want to see the exact timestamp of each detected event, so that I can understand when the seismic disturbance occurred.
10) As an Operator, I want to access the historical list of detected events, so that I can inspect past seismic activity after the live moment has passed.
11) As an Operator, I want to be able to see historical events even if the measurements are offline, so that I can always check past events.
12) As an Operator, I want to filter historical events to earthquakes, conventional explosions or nuclear-like events, so that I can analyze which location is more prone to which event.
13) As an Operator, I want to filter historical events by sensor, so that I can investigate the activity associated with a specific seismic device.
14) As an Operator, I want to filter historical events by region, so that I can focus my analysis on a specific geographic area.
15) As an Operator, I want to filter historical events by peak amplitude, so that I can focus my analysis on the strongest threats.
16) As an Administrator, I want to see the current live monitoring status in the system health status dashboard, so that I can quickly understand whether the system is operating correctly.
17) As an Administrator, I want the historical event list to show only one consolidated record for each detected event, so that the event history remains clear and free of duplicates.
18) As an Administrator, I want to see the status of all processing replicas in the dashboard, so that I can immediately identify which nodes are currently available.
19) As an Administrator, I want the dashboard to highlight the timestamp when a processing replica becomes unavailable, so that node failures are clearly traceable.
20) As an Administrator, I want the dashboard to remain usable when one processing replica fails, so that I can continue monitoring the system without interruption.

# CONTAINERS:

## CONTAINER_NAME: Simulator

### DESCRIPTION:
Provided seismic signal simulator used as the external source of sensors, live measurements, and shutdown commands.

### USER STORIES:
Provides sensor discovery data for user stories: 1, 2, 3. Provides live sample streams that feed user stories: 5, 6, 8, 9. Provides shutdown control input that stresses user stories: 16, 18, 19, 20.

### PORTS:
8080:8080

### DESCRIPTION:
The platform uses the Docker Hub public image `mattia9203/seismic-signal-simulator:multiarch_v1` as the external simulator. It exposes the discovery API, the per-sensor WebSocket streams, the SSE control stream used by the replicas, and a health endpoint with runtime configuration.

### PERSISTENCE EVALUATION
The simulator is used as an external stateless component and does not require persistence in our deployment.

### EXTERNAL SERVICES CONNECTIONS
No external service connections are implemented for this container.

### MICROSERVICES:

#### MICROSERVICE: simulator
- TYPE: backend
- DESCRIPTION: External service generating sensor discovery data, time-domain seismic samples, shutdown commands, and health information.
- PORTS: 8080
- TECHNOLOGICAL SPECIFICATION: External simulator service integrated through its published HTTP, WebSocket, and SSE contract.
- SERVICE ARCHITECTURE: The simulator provides sensor discovery, live measurements, and shutdown commands to the rest of the platform.
- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| GET | /api/devices/ | Returns the list of available sensors and their metadata. | Supports 1, 2, 3 |
| WS | /api/device/{sensor_id}/ws | Streams live samples for a specific sensor. | Feeds 5, 6, 8, 9 |
| GET | /api/control | SSE stream used by replicas to receive shutdown commands. | Triggers 16, 18, 19, 20 |
| GET | /health | Returns simulator status and runtime configuration. | Indirect operational support for 16, 18, 19, 20 |


## CONTAINER_NAME: Custom-Broker

### DESCRIPTION:
Collects sensor metadata and live measurements from the simulator and redistributes them to all connected processing replicas.

### USER STORIES:
Handles discovery fan-out and measurement broadcast for user stories: 1, 2, 3, 5, 6, 8, 9.

### PORTS:
9000:9000

### DESCRIPTION:
The Custom-Broker container is responsible for discovery and ingestion only. It calls the simulator discovery API, opens one WebSocket stream for each sensor, normalizes each incoming sample into a measurement envelope, and broadcasts that envelope to all connected replicas.

### PERSISTENCE EVALUATION
The Custom-Broker container is stateless. It does not persist measurements, detections, or sensor metadata.

### EXTERNAL SERVICES CONNECTIONS
The Custom-Broker container connects to the simulator through HTTP and WebSocket and accepts WebSocket connections from the processing replicas.

### MICROSERVICES:

#### MICROSERVICE: custom-broker
- TYPE: backend
- DESCRIPTION: Discovers sensors, opens sensor streams, and broadcasts normalized measurement payloads to all connected replicas.
- PORTS: 9000
- TECHNOLOGICAL SPECIFICATION:
The microservice is developed in Python 3.11 and uses `httpx` for discovery and `websockets` for both upstream sensor streams and downstream replica connections.
- SERVICE ARCHITECTURE:
The service starts a WebSocket server for replicas, waits until the expected number of replicas (5) is connected, then discovers sensors and creates one listener task per sensor. Every incoming sample is wrapped together with sensor metadata and broadcast to all replicas.
- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| WS | /ws/ingest | Internal WebSocket endpoint used by replicas to connect and receive normalized live measurements. | Feeds 1, 2, 3, 5, 6, 8, 9 |

## CONTAINER_NAME: Processing-Replica-Cluster

### DESCRIPTION:
Set of five identical processing containers that perform sliding-window analysis, FFT-based classification, and alert forwarding toward the gateway.

### USER STORIES:
Performs detection, classification, and gateway forwarding for user stories: 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17. Exposes replica health and reacts to shutdown commands for user stories: 16, 18, 19, 20.

### PORTS:
Each replica exposes `/health` on port `8000`. In the Docker Compose deployment this port is used only inside the Docker network, so the replicas are reached by service name and no host port is published.

### DESCRIPTION:
The deployed system starts five instances of the same processing service: `replica-1`, `replica-2`, `replica-3`, `replica-4`, and `replica-5`. Each replica receives the same measurement stream from the broker, maintains a per-sensor sliding window, runs FFT analysis, classifies detected disturbances, forwards sensor metadata and detections to the gateway, and exposes a health endpoint.

### PERSISTENCE EVALUATION
The processing replicas do not store state locally on disk and do not own direct database access anymore. Persistent data is delegated to PostgreSQL through the gateway. In-memory state is limited to sensor windows, counters, caches, and the HTTP client pool.

### EXTERNAL SERVICES CONNECTIONS
The replicas connect to:

- the Custom-Broker through WebSocket
- the Gateway through HTTP
- the Simulator through the SSE control stream when enabled

### MICROSERVICES:

#### MICROSERVICE: processing-replica
- TYPE: backend
- DESCRIPTION: Performs FFT-based analysis on sliding windows, classifies seismic events, and forwards sensor metadata and alerts to the gateway.
- PORTS: `8000` for the replica health endpoint; upstream connections to the broker on `9000` and to the gateway on `8001`
- TECHNOLOGICAL SPECIFICATION:
The microservice is developed in Python 3.11 and uses FastAPI for `/health`, `websockets` for broker consumption, `numpy` for FFT, `httpx` for forwarding sensor metadata and events to the gateway, and `httpx-sse` for the simulator control stream.
- SERVICE ARCHITECTURE:
The service consumes the broker stream continuously, stores a fixed-size window for each sensor, runs overlapping FFT analysis, applies the hard-coded seismic classification rules, forwards static sensor metadata to the gateway once per sensor, and forwards enriched detected events to the gateway. A health server runs in parallel, and the replica can shut down gracefully on simulator control commands.
- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| GET | /health | Returns the replica health status used by the gateway for cluster monitoring. | Supports 16, 18, 19, 20 |


## CONTAINER_NAME: Gateway

### DESCRIPTION:
Single entry point for the frontend and internal ingestion point for replica submissions. Exposes historical APIs, event details, cluster status, and the live WebSocket feed.

### USER STORIES:
Aggregates dashboard APIs and live feeds for user stories: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20. Enforces consolidated live and persisted event delivery for user story: 17.

### PORTS:
8001:8001

### DESCRIPTION:
The Gateway container receives sensor metadata and detected events from the replicas, suppresses duplicate live alerts, persists the consolidated data into PostgreSQL, exposes the dashboard APIs over the stored data, monitors replica health, and broadcasts live events to connected dashboard clients. It is the only backend service directly accessed by the frontend.

### PERSISTENCE EVALUATION
The Gateway container does not own local persistent storage, but it is the only service responsible for writing persistent platform data. It upserts sensor metadata and inserts deduplicated events into PostgreSQL while keeping only a short in-memory cache for live duplicate suppression and the current replica-health state.

### EXTERNAL SERVICES CONNECTIONS
The Gateway container connects to PostgreSQL and polls all configured replica `/health` endpoints. It also accepts HTTP sensor and event submissions from the replicas and WebSocket connections from the frontend.

### MICROSERVICES:

#### MICROSERVICE: gateway
- TYPE: backend
- DESCRIPTION: Aggregates the replicated processing layer and exposes the APIs consumed by the dashboard.
- PORTS: 8001
- TECHNOLOGICAL SPECIFICATION:
The microservice is developed in Python 3.11 and uses FastAPI, `asyncpg`, `httpx`, and native WebSocket support through FastAPI/Uvicorn.
- SERVICE ARCHITECTURE:
The service exposes internal ingestion APIs for sensors and events, REST APIs for historical queries and event details, a live WebSocket feed for the dashboard, and a periodic health check task that polls all configured replicas. Incoming events are deduplicated in memory, persisted to PostgreSQL with the existing schema, and only then broadcast to the dashboard.
- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| POST | /api/sensors | Receives sensor metadata from the replicas and upserts the `sensors` table. | Supports 1, 2, 3 |
| POST | /api/events | Receives detected events from the replicas, deduplicates them, and persists them to PostgreSQL. | Supports 17 |
| GET | /api/system/status | Returns the aggregated health summary of the processing cluster. | Supports 4, 16, 18, 19, 20 |
| WS | /ws/live | Pushes live deduplicated events to the dashboard. | Feeds 5, 6, 8, 9, 17 |
| GET | /api/history | Returns persisted historical events with filters by time, sensor, region, event type, and frequency; the frontend applies the minimum-amplitude filter locally. | Supports 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17 |
| GET | /api/sensors | Returns the persisted sensor list. | Supports 1, 2, 3, 13, 14 |
| GET | /api/events/{event_id} | Returns the details of a single event. | Supports 7, 8, 9 |


## CONTAINER_NAME: PostgreSQL

### DESCRIPTION:
Persistent storage used for sensor metadata and detected events.

### USER STORIES:
Persists sensor metadata and event history for user stories: 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15. Enforces unique event storage together with gateway-side deduplication for user story: 17.

### PORTS:
5432:5432

### DESCRIPTION:
The PostgreSQL container stores the consolidated state of the platform. It keeps the registered sensors and the deduplicated list of detected events. Persistence is enabled through the Docker volume `postgres-data` and the schema is initialized by `source/init.sql`.

### PERSISTENCE EVALUATION
This container is the persistent core of the platform. It guarantees history retention across service restarts and is essential for duplicate-safe event storage.

### EXTERNAL SERVICES CONNECTIONS
The PostgreSQL container is used only by the gateway for both writes and reads.

### MICROSERVICES:

#### MICROSERVICE: postgres
- TYPE: database
- DESCRIPTION: Stores sensor metadata and detected seismic events.
- PORTS: 5432
- TECHNOLOGICAL SPECIFICATION:
Standard PostgreSQL 16 Alpine image.
- DB STRUCTURE:

  **_sensors_** : | **_sensor_id_** | sensor_name | category | region | latitude | longitude | measurement_unit |

  **_events_** : | **_id_** | **_event_id_** | sensor_id | event_type | last_sample_timestamp | peak_frequency | peak_amplitude | duration |



## CONTAINER_NAME: Frontend

### DESCRIPTION:
React-based dashboard used by operators and administrators to monitor the system, inspect events, and view replica health.

### USER STORIES:
Implements operator-facing dashboard views for user stories: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15. Implements administrator monitoring views for user stories: 16, 17, 18, 19, 20.

### PORTS:
3000:80

### DESCRIPTION:
The Frontend container serves the dashboard through Nginx. It proxies all API calls and live WebSocket traffic to the gateway, so the browser interacts with the system through a single access point. The implemented pages are Sensors, Historical Events, Event Details, and System Health.

### PERSISTENCE EVALUATION
The Frontend container does not require persistence. All durable state is delegated to the backend services.

### EXTERNAL SERVICES CONNECTIONS
The Frontend container connects only to the Gateway through the Nginx reverse proxy configuration.

### MICROSERVICES:

#### MICROSERVICE: frontend
- TYPE: frontend
- DESCRIPTION: Provides the web dashboard for real-time monitoring, event inspection, historical analysis, and replica health monitoring.
- PORTS: 80
- TECHNOLOGICAL SPECIFICATION:
The frontend is developed with React and React Router. Production serving is performed through Nginx, which proxies `/api/*` and `/ws/live` to the gateway.
- SERVICE ARCHITECTURE:
The dashboard is implemented as a single-page application with four main views. The Sensors page aggregates persisted sensors and latest events, the Historical Events page combines persisted history with live WebSocket updates, the Event Details page shows a detailed event view, and a shared React context polls the gateway periodically to feed the System Health page with replica availability data.
- PAGES:

| Name | Description | Related Microservice | User Stories |
| ---- | ----------- | -------------------- | ------------ |
| Sensors | Displays sensor cards, summary metrics, category, region, coordinates, latest event, dominant frequency, and live monitoring status. | frontend | Implements 1, 2, 3, 4, 5, 6 |
| Historical Events | Displays persisted events plus live updates with classification, timestamp, dominant frequency, peak amplitude, and filters by event type, sensor, region, and client-side minimum amplitude. | frontend | Implements 8, 9, 10, 11, 12, 13, 14, 15, 17 |
| Event Details | Displays a detailed view of the selected event with classification, timestamps, peak amplitude, and sensor context. | frontend | Implements 7, 8, 9 |
| System Health | Displays current live monitoring status, replica counts, availability, failure timestamps, and cluster health events. | frontend | Implements 4, 16, 18, 19, 20 |

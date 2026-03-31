from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from datetime import datetime
from collections import deque
import asyncio
import httpx
import json
import os
import logging
from urllib.parse import urlsplit

import asyncpg
from typing import Optional

# ==========================================
# 1. LOGGING CONFIGURATION
# ==========================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] gateway — %(message)s",
)
log = logging.getLogger("gateway")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

# ==========================================
# 2. CONFIGURATION & STATE
# ==========================================
# Defaults for local runs; Docker Compose can override via REPLICA_URLS.
DEFAULT_REPLICA_PORTS = [8000, 8002, 8004, 8006, 8008, 8010]
raw_replicas = os.getenv("REPLICA_URLS")
if raw_replicas:
    ALL_INITIAL_REPLICAS = [
        url.strip() for url in raw_replicas.split(",") if url.strip()
    ]
else:
    ALL_INITIAL_REPLICAS = [
        f"http://127.0.0.1:{port}" for port in DEFAULT_REPLICA_PORTS
    ]
REPLICA_PORTS = [
    parsed.port
    for parsed in (urlsplit(url) for url in ALL_INITIAL_REPLICAS)
    if parsed.port
]

active_replicas = list(ALL_INITIAL_REPLICAS)
dead_replicas = []

recent_events_cache = deque(maxlen=100)
seen_sensors_cache: set[str] = set()

DB_DSN = os.getenv("DB_DSN", "postgresql://replica:replica@localhost:5432/seismic")
db_pool: asyncpg.Pool | None = None


# ==========================================
# 3. WEBSOCKET CONNECTION MANAGER
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        log.info(f"New dashboard connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            log.info(f"Dashboard disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        json_message = json.dumps(message, default=str)
        for connection in self.active_connections:
            try:
                await connection.send_text(json_message)
            except Exception:
                pass


ws_manager = ConnectionManager()


# ==========================================
# 4. DATABASE HELPERS
# ==========================================
def _extract_coordinates(payload: dict) -> tuple[float | None, float | None]:
    coordinates = payload.get("coordinates") or {}
    latitude = payload.get("latitude", coordinates.get("latitude"))
    longitude = payload.get("longitude", coordinates.get("longitude"))
    return latitude, longitude


def _parse_timestamp(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def _build_live_payload(payload: dict) -> dict:
    latitude, longitude = _extract_coordinates(payload)
    return {
        "event_id": payload.get("event_id"),
        "sensor_id": payload.get("sensor_id"),
        "event_type": payload.get("event_type"),
        "last_sample_timestamp": payload.get("last_sample_timestamp"),
        "peak_frequency": payload.get("peak_frequency"),
        "peak_amplitude": payload.get("peak_amplitude"),
        "duration": payload.get("duration"),
        "sensor_name": payload.get("sensor_name"),
        "category": payload.get("category"),
        "region": payload.get("region"),
        "measurement_unit": payload.get("measurement_unit"),
        "latitude": latitude,
        "longitude": longitude,
    }


async def upsert_sensor(payload: dict) -> bool:
    if db_pool is None:
        log.error("Cannot register sensor without a DB connection.")
        return False

    sensor_id = payload.get("sensor_id")
    if not sensor_id:
        log.warning("Sensor registration skipped because sensor_id is missing.")
        return False

    if sensor_id in seen_sensors_cache:
        return True

    latitude, longitude = _extract_coordinates(payload)

    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO sensors
                    (sensor_id, sensor_name, category, region,
                     latitude, longitude, measurement_unit)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (sensor_id) DO UPDATE
                SET
                    sensor_name = COALESCE(EXCLUDED.sensor_name, sensors.sensor_name),
                    category = COALESCE(EXCLUDED.category, sensors.category),
                    region = COALESCE(EXCLUDED.region, sensors.region),
                    latitude = COALESCE(EXCLUDED.latitude, sensors.latitude),
                    longitude = COALESCE(EXCLUDED.longitude, sensors.longitude),
                    measurement_unit = COALESCE(
                        EXCLUDED.measurement_unit,
                        sensors.measurement_unit
                    );
                """,
                sensor_id,
                payload.get("sensor_name"),
                payload.get("category"),
                payload.get("region"),
                latitude,
                longitude,
                payload.get("measurement_unit"),
            )
        seen_sensors_cache.add(sensor_id)
        log.info("Sensor registered through gateway: %s", sensor_id)
        return True
    except Exception as exc:
        seen_sensors_cache.discard(sensor_id)
        log.error("DB error upserting sensor %s: %s", sensor_id, exc)
        return False


async def persist_event(payload: dict) -> str:
    if db_pool is None:
        log.error("Cannot persist event without a DB connection.")
        return "db_unavailable"

    try:
        timestamp = _parse_timestamp(payload["last_sample_timestamp"])
        async with db_pool.acquire() as conn:
            status = await conn.execute(
                """
                INSERT INTO events
                    (event_id, sensor_id, event_type, last_sample_timestamp,
                     peak_frequency, peak_amplitude, duration)
                VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7)
                ON CONFLICT (event_id) DO NOTHING;
                """,
                payload["event_id"],
                payload["sensor_id"],
                payload["event_type"],
                timestamp,
                payload.get("peak_frequency"),
                payload.get("peak_amplitude"),
                payload.get("duration"),
            )
        if status.endswith("1"):
            log.info(
                "Event persisted by gateway: event_id=%s sensor=%s type=%s ts=%s",
                payload["event_id"],
                payload["sensor_id"],
                payload["event_type"],
                payload["last_sample_timestamp"],
            )
            return "inserted"
        return "duplicate"
    except Exception as exc:
        log.error("DB error persisting event %s: %s", payload.get("event_id"), exc)
        return "error"


# ==========================================
# 5. HEALTH CHECK TASK
# ==========================================
async def ping_replicas_continuously():
    """Refresh replica health from a fixed set of local ports."""
    global active_replicas
    global dead_replicas

    async with httpx.AsyncClient(timeout=2.0) as client:
        while True:
            healthy_replicas = []
            unreachable_replicas = []

            for replica_url in ALL_INITIAL_REPLICAS:
                try:
                    response = await client.get(f"{replica_url}/health")
                    if response.status_code == 200:
                        healthy_replicas.append(replica_url)
                    else:
                        unreachable_replicas.append(replica_url)
                except Exception as e:
                    log.warning(f"Health check fallito per {replica_url}: {e}")
                    unreachable_replicas.append(replica_url)

            active_replicas = healthy_replicas
            dead_replicas = unreachable_replicas

            await asyncio.sleep(5)


# ==========================================
# 6. LIFESPAN & APP INIT
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    log.info(f"Gateway starting with replicas: {ALL_INITIAL_REPLICAS}")

    # 1. Start the Health Check task
    health_task = asyncio.create_task(ping_replicas_continuously())

    # 2. Connect the Gateway to the Database
    try:
        db_pool = await asyncpg.create_pool(dsn=DB_DSN, min_size=1, max_size=10)
        log.info("Gateway connected to PostgreSQL database.")
    except Exception as e:
        log.error(f"Failed to connect to DB: {e}")

    yield

    health_task.cancel()
    if db_pool:
        await db_pool.close()
    log.info("Gateway shutting down.")


app = FastAPI(title="Seismic Intelligence Gateway", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 7. API ROUTES
# ==========================================


@app.post("/api/sensors")
async def register_sensor(payload: dict):
    sensor_id = payload.get("sensor_id")
    if not sensor_id:
        raise HTTPException(status_code=400, detail="missing_sensor_id")

    registered = await upsert_sensor(payload)
    if not registered:
        raise HTTPException(status_code=503, detail="sensor_persistence_failed")

    return {"status": "registered", "sensor_id": sensor_id}


@app.post("/api/events")
async def receive_event(payload: dict):
    sensor_id = payload.get("sensor_id")
    event_id = payload.get("event_id")

    if not event_id:
        raise HTTPException(status_code=400, detail="missing_event_id")
    if not sensor_id:
        raise HTTPException(status_code=400, detail="missing_sensor_id")
    if not payload.get("event_type"):
        raise HTTPException(status_code=400, detail="missing_event_type")
    if not payload.get("last_sample_timestamp"):
        raise HTTPException(status_code=400, detail="missing_last_sample_timestamp")

    normalized_payload = dict(payload)
    normalized_payload["event_id"] = event_id

    if event_id in recent_events_cache:
        log.info(
            "DUPLICATE: event_id=%s type=%s sensor=%s amp=%s",
            event_id,
            normalized_payload.get("event_type"),
            sensor_id,
            normalized_payload.get("peak_amplitude"),
        )
        return {"status": "ignored", "reason": "duplicate"}

    sensor_registered = await upsert_sensor(normalized_payload)
    if not sensor_registered:
        raise HTTPException(status_code=503, detail="sensor_persistence_failed")

    persistence_status = await persist_event(normalized_payload)
    if persistence_status == "duplicate":
        recent_events_cache.append(event_id)
        log.info(
            "DUPLICATE(DB): event_id=%s type=%s sensor=%s",
            event_id,
            normalized_payload.get("event_type"),
            sensor_id,
        )
        return {"status": "ignored", "reason": "duplicate"}

    if persistence_status != "inserted":
        raise HTTPException(status_code=503, detail="event_persistence_failed")

    recent_events_cache.append(event_id)
    live_payload = _build_live_payload(normalized_payload)
    log.info(
        "ALERT: event_id=%s type=%s sensor=%s amp=%s",
        event_id,
        live_payload.get("event_type"),
        sensor_id,
        live_payload.get("peak_amplitude"),
    )

    await ws_manager.broadcast(live_payload)

    return {"status": "dispatched", "event_id": event_id}


@app.get("/api/system/status")
async def get_system_status():
    return {
        "status": "operational" if active_replicas else "critical",
        "configured_replicas": ALL_INITIAL_REPLICAS,
        "configured_ports": REPLICA_PORTS,
        "nodes": {
            "total": len(ALL_INITIAL_REPLICAS),
            "online": len(active_replicas),
            "offline": len(dead_replicas),
        },
        "active_list": active_replicas,
        "dead_list": dead_replicas,
    }


# ==========================================
# 8. WEBSOCKET ROUTE
# ==========================================
@app.websocket("/ws/live")
async def websocket_live_feed(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep the connection open
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


# ==========================================
# 9. HISTORY ROUTE
# ==========================================
@app.get("/api/history")
async def get_historical_events(
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    sensor_id: Optional[str] = None,
    region: Optional[str] = None,
    event_type: Optional[str] = None,
    min_freq: Optional[float] = None,
    max_freq: Optional[float] = None,
    limit: int = 100,
):
    if not db_pool:
        return {"error": "Database connection unavailable"}

    query = """
        SELECT 
            e.id, e.event_id, e.sensor_id, e.event_type, e.last_sample_timestamp, 
            e.peak_frequency, e.peak_amplitude, e.duration,
            s.region, s.sensor_name
        FROM events e
        JOIN sensors s ON e.sensor_id = s.sensor_id
        WHERE 1=1
    """

    params = []

    if start_time:
        params.append(start_time)
        query += f" AND e.last_sample_timestamp >= ${len(params)}"

    if end_time:
        params.append(end_time)
        query += f" AND e.last_sample_timestamp <= ${len(params)}"

    if sensor_id:
        params.append(sensor_id)
        query += f" AND e.sensor_id = ${len(params)}"

    if region:
        params.append(region)
        query += f" AND s.region = ${len(params)}"

    if event_type:
        params.append(event_type)
        query += f" AND e.event_type = ${len(params)}"

    if min_freq is not None:
        params.append(min_freq)
        query += f" AND e.peak_frequency >= ${len(params)}"

    if max_freq is not None:
        params.append(max_freq)
        query += f" AND e.peak_frequency <= ${len(params)}"

    params.append(limit)
    query += f" ORDER BY e.last_sample_timestamp DESC LIMIT ${len(params)}"

    async with db_pool.acquire() as conn:
        records = await conn.fetch(query, *params)

    results = [dict(record) for record in records]

    return {
        "count": len(results),
        "filters_applied": len(params) - 1,
        "data": results,
    }


@app.get("/api/sensors")
async def get_sensors():
    """Retrieves all static sensor data."""
    if not db_pool:
        return {"error": "Database connection unavailable"}

    query = "SELECT * FROM sensors ORDER BY sensor_name ASC"
    async with db_pool.acquire() as conn:
        records = await conn.fetch(query)

    return {"data": [dict(record) for record in records]}


@app.get("/api/events/{event_id}")
async def get_event_details(event_id: str):
    """Retrieves detailed information for a specific event."""
    if not db_pool:
        return {"error": "Database connection unavailable"}

    query = """
        SELECT e.*, s.sensor_name, s.category, s.region, s.latitude, s.longitude, s.measurement_unit
        FROM events e
        JOIN sensors s ON e.sensor_id = s.sensor_id
        WHERE e.event_id = $1
    """
    async with db_pool.acquire() as conn:
        record = await conn.fetchrow(query, event_id)

    if not record:
        return {"error": "Event not found"}

    return {"data": dict(record)}

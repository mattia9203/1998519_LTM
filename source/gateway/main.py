from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel
from datetime import datetime
from collections import deque
import asyncio
import httpx
import json
import os
import logging

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

# ==========================================
# 2. CONFIGURATION & STATE
# ==========================================
# In Docker, we will pass the service names (e.g., http://replica-1:8000) 
# comma-separated via the REPLICA_URLS environment variable.
raw_replicas = os.getenv("REPLICA_URLS", "http://127.0.0.1:8000,http://127.0.0.1:8001")
ALL_INITIAL_REPLICAS = [r.strip() for r in raw_replicas.split(",") if r.strip()]

active_replicas = list(ALL_INITIAL_REPLICAS)
dead_replicas = []

# Cache for event deduplication [cite: 71, 98]
recent_events_cache = deque(maxlen=100)

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
        """Broadcasts the event to all connected frontends[cite: 113]."""
        json_message = json.dumps(message, default=str)
        for connection in self.active_connections:
            try:
                await connection.send_text(json_message)
            except Exception:
                # Silent handling of unclean disconnections
                pass

ws_manager = ConnectionManager()

# ==========================================
# 4. HEALTH CHECK TASK (Fault Tolerance [cite: 105, 106, 137])
# ==========================================
async def ping_replicas_continuously():
    """Automatically detects failed nodes and removes them from the pool[cite: 106]."""
    async with httpx.AsyncClient(timeout=2.0) as client:
        while True:
            for replica_url in active_replicas[:]:
                try:
                    response = await client.get(f"{replica_url}/health")
                    if response.status_code != 200:
                        raise httpx.ConnectError("Unhealthy status")
                except (httpx.ConnectError, httpx.ReadTimeout):
                    log.error(f"Replica FAILURE detected: {replica_url}. Removing from pool.")
                    active_replicas.remove(replica_url)
                    dead_replicas.append(replica_url)
            
            if not active_replicas:
                log.critical("ALL REPLICAS ARE DEAD. System cannot process new events.")
            
            await asyncio.sleep(5)

# ==========================================
# 5. LIFESPAN & APP INIT
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    log.info(f"Gateway starting with replicas: {ALL_INITIAL_REPLICAS}")
    
    # 1. Start the Health Check task
    health_task = asyncio.create_task(ping_replicas_continuously())
    
    # 2. Connect the Gateway to the Database (read-only)
    try:
        db_pool = await asyncpg.create_pool(dsn=DB_DSN, min_size=1, max_size=10)
        log.info("Gateway connected to PostgreSQL database.")
    except Exception as e:
        log.error(f"Failed to connect to DB: {e}")

    yield
    
    # Shutdown sequence
    health_task.cancel()
    if db_pool:
        await db_pool.close()
    log.info("Gateway shutting down.")

# Initialize FastAPI App (CRITICAL FIX - THIS WAS MISSING!)
app = FastAPI(title="Seismic Intelligence Gateway", lifespan=lifespan)

# Add CORS Middleware to allow React dashboard communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production to the specific frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 6. API ROUTES
# ==========================================

@app.post("/api/events")
async def receive_event(payload: dict):
    """
    Entry point for seismic alerts.
    Implements deduplication to handle multiple replicas[cite: 71, 98].
    """
    sensor_id = payload.get("sensor_id")
    timestamp = payload.get("last_sample_timestamp")
    event_id = f"{sensor_id}_{timestamp}"

    # Duplicate check
    if event_id in recent_events_cache:
        return {"status": "ignored", "reason": "duplicate"}

    recent_events_cache.append(event_id)
    log.info(f"🚨 ALERT: {payload.get('event_type')} from {sensor_id} (Amp: {payload.get('peak_amplitude')})")
    
    # Forward to Live Feed via WebSocket [cite: 110]
    await ws_manager.broadcast(payload)
    
    return {"status": "dispatched", "event_id": event_id}

@app.get("/api/system/status")
async def get_system_status():
    """Node status monitoring for the dashboard[cite: 109]."""
    return {
        "status": "operational" if active_replicas else "critical",
        "nodes": {
            "total": len(ALL_INITIAL_REPLICAS),
            "online": len(active_replicas),
            "offline": len(dead_replicas)
        },
        "active_list": active_replicas,
        "dead_list": dead_replicas
    }

# ==========================================
# 7. WEBSOCKET ROUTE
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
# 8. HISTORY ROUTE
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
    limit: int = 100
):
    """
    Retrieves the history of seismic events with advanced filters.
    Joins the 'events' table with 'sensors' to filter by region as well[cite: 111, 112].
    """
    if not db_pool:
        return {"error": "Database connection unavailable"}

    # Base query with JOIN between events and sensors
    query = """
        SELECT 
            e.id, e.sensor_id, e.event_type, e.last_sample_timestamp, 
            e.peak_frequency, e.peak_amplitude, e.duration,
            s.region, s.sensor_name
        FROM events e
        JOIN sensors s ON e.sensor_id = s.sensor_id
        WHERE 1=1
    """
    
    # Build filters dynamically for asyncpg ($1, $2, etc.)
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
        
    # Order from newest to oldest and apply the limit
    params.append(limit)
    query += f" ORDER BY e.last_sample_timestamp DESC LIMIT ${len(params)}"

    # Execute the query on the database
    async with db_pool.acquire() as conn:
        records = await conn.fetch(query, *params)
        
    # Format the results into a list of JSON-friendly dictionaries
    results = [dict(record) for record in records]
    
    return {
        "count": len(results),
        "filters_applied": len(params) - 1, # Exclude 'limit' from the filter count
        "data": results
    }
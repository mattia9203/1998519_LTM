import asyncio
import logging
import os
import signal
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import orjson
import websockets
from websockets.exceptions import ConnectionClosedOK


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("custom_broker")


@dataclass(slots=True)
class BrokerConfig:
    simulator_base_url: str
    broker_host: str
    broker_port: int
    replica_ingest_path: str
    expected_replica_count: int
    startup_barrier_poll_interval: float

    @classmethod
    def from_env(cls) -> "BrokerConfig":
        return cls(
            simulator_base_url=os.getenv("SIMULATOR_BASE_URL", "http://simulator:8080"),
            broker_host=os.getenv("BROKER_HOST", "0.0.0.0"),
            broker_port=int(os.getenv("BROKER_PORT", "9000")),
            replica_ingest_path=os.getenv("REPLICA_INGEST_PATH", "/ws/ingest"),
            expected_replica_count=int(os.getenv("EXPECTED_REPLICA_COUNT", "5")),
            startup_barrier_poll_interval=float(
                os.getenv("STARTUP_BARRIER_POLL_INTERVAL", "0.5")
            ),
        )


@dataclass(slots=True)
class Sensor:
    sensor_id: str
    name: str
    category: str
    region: str
    coordinates: dict[str, float]
    measurement_unit: str
    sampling_rate_hz: float
    websocket_url: str


@dataclass(slots=True)
class ReplicaConnection:
    replica_id: int
    websocket: Any = None
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# ---------------------------------------------------------------------------
# Retry configuration for sensor reconnection
# ---------------------------------------------------------------------------
SENSOR_RECONNECT_BASE_DELAY = float(os.getenv("SENSOR_RECONNECT_BASE_DELAY", "1.0"))
SENSOR_RECONNECT_MAX_DELAY = float(os.getenv("SENSOR_RECONNECT_MAX_DELAY", "30.0"))
SENSOR_RECONNECT_MAX_ATTEMPTS = int(os.getenv("SENSOR_RECONNECT_MAX_ATTEMPTS", "0"))  # 0 = infinite


class Broker:
    def __init__(self, config: BrokerConfig) -> None:
        self.config = config
        self.http_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=10.0))
        self.stop_event = asyncio.Event()
        self.sensors: list[Sensor] = []
        self.replicas: dict[int, ReplicaConnection] = {}
        self.next_replica_id = 1
        self.replica_lock = asyncio.Lock()
        self.replica_server: Any = None
        self.tasks: list[asyncio.Task[Any]] = []

    async def run(self) -> None:
        self.replica_server = await websockets.serve(
            self._handle_replica_connection,
            self.config.broker_host,
            self.config.broker_port,
        )

        await self._wait_for_replica_quorum()
        await self._discover_sensors()

        for sensor in self.sensors:
            self.tasks.append(
                asyncio.create_task(
                    self._sensor_listener(sensor),
                    name=f"sensor-{sensor.sensor_id}",
                )
            )

        logger.info(
            "Broker started with %d sensors, replica ingress on %s:%d%s",
            len(self.sensors),
            self.config.broker_host,
            self.config.broker_port,
            self.config.replica_ingest_path,
        )

        await self.stop_event.wait()

    async def stop(self) -> None:
        self.stop_event.set()

        for task in self.tasks:
            task.cancel()

        for task in self.tasks:
            with suppress(asyncio.CancelledError):
                await task

        if self.replica_server is not None:
            self.replica_server.close()
            await self.replica_server.wait_closed()

        async with self.replica_lock:
            replicas = list(self.replicas.values())
            self.replicas.clear()

        for replica in replicas:
            if replica.websocket is not None:
                with suppress(Exception):
                    await replica.websocket.close()

        await self.http_client.aclose()

    async def _discover_sensors(self) -> None:
        url = f"{self.config.simulator_base_url.rstrip('/')}/api/devices/"
        logger.info("Discovering sensors from %s", url)
        response = await self.http_client.get(url)
        response.raise_for_status()
        data = response.json()

        if not isinstance(data, list):
            raise ValueError("GET /api/devices/ must return a JSON array")

        self.sensors = [self._parse_sensor(item) for item in data]
        logger.info("Discovered %d sensors", len(self.sensors))

    async def _wait_for_replica_quorum(self) -> None:
        expected = self.config.expected_replica_count
        if expected <= 0:
            return

        logger.info(
            "Waiting for %d replicas before starting sensor streams",
            expected,
        )
        last_reported = -1

        while not self.stop_event.is_set():
            async with self.replica_lock:
                connected = len(self.replicas)

            if connected >= expected:
                logger.info(
                    "Startup barrier satisfied: %d/%d replicas connected",
                    connected,
                    expected,
                )
                return

            if connected != last_reported:
                logger.info(
                    "Replica barrier progress: %d/%d connected",
                    connected,
                    expected,
                )
                last_reported = connected

            await asyncio.sleep(self.config.startup_barrier_poll_interval)

    def _parse_sensor(self, data: dict[str, Any]) -> Sensor:
        coordinates = data.get("coordinates") or {}

        return Sensor(
            sensor_id=str(data["id"]),
            name=str(data["name"]),
            category=str(data["category"]),
            region=str(data["region"]),
            coordinates={
                "latitude": float(coordinates["latitude"]),
                "longitude": float(coordinates["longitude"]),
            },
            measurement_unit=str(data["measurement_unit"]),
            sampling_rate_hz=float(data["sampling_rate_hz"]),
            websocket_url=str(data["websocket_url"]),
        )

    async def _sensor_listener(self, sensor: Sensor) -> None:
        """Connect to a sensor WebSocket with automatic reconnection on failure."""
        sensor_ws_url = self._build_sensor_ws_url(sensor.websocket_url)
        backoff = SENSOR_RECONNECT_BASE_DELAY
        attempts = 0

        while not self.stop_event.is_set():
            websocket = None
            try:
                logger.info(
                    "Connecting to sensor %s at %s", sensor.sensor_id, sensor_ws_url
                )
                websocket = await websockets.connect(sensor_ws_url)
                logger.info("Connected to sensor %s", sensor.sensor_id)

                # Reset backoff on successful connection
                backoff = SENSOR_RECONNECT_BASE_DELAY
                attempts = 0

                async for raw_message in websocket:
                    if self.stop_event.is_set():
                        return

                    if isinstance(raw_message, bytes):
                        raw_message = raw_message.decode("utf-8")

                    measurement = orjson.loads(raw_message)
                    outgoing = orjson.dumps(
                        {
                            "sensor_id": sensor.sensor_id,
                            "sensor_name": sensor.name,
                            "category": sensor.category,
                            "region": sensor.region,
                            "coordinates": sensor.coordinates,
                            "measurement_unit": sensor.measurement_unit,
                            "sampling_rate_hz": sensor.sampling_rate_hz,
                            "timestamp": measurement["timestamp"],
                            "value": measurement["value"],
                        }
                    )
                    await self._broadcast(outgoing)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "Sensor %s stream closed: %s — reconnecting in %.1fs",
                    sensor.sensor_id,
                    exc,
                    backoff,
                )
            finally:
                if websocket is not None:
                    with suppress(Exception):
                        await websocket.close()

            # Check if we should stop retrying
            if self.stop_event.is_set():
                return

            attempts += 1
            if SENSOR_RECONNECT_MAX_ATTEMPTS > 0 and attempts >= SENSOR_RECONNECT_MAX_ATTEMPTS:
                logger.error(
                    "Sensor %s: max reconnect attempts (%d) reached — giving up.",
                    sensor.sensor_id,
                    SENSOR_RECONNECT_MAX_ATTEMPTS,
                )
                return

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, SENSOR_RECONNECT_MAX_DELAY)

    async def _broadcast(self, message: bytes) -> None:
        """Send a pre-serialized message to all connected replicas in parallel."""
        async with self.replica_lock:
            connected_replicas = list(self.replicas.values())

        if not connected_replicas:
            return

        await asyncio.gather(
            *(
                self._send_to_replica(replica, message)
                for replica in connected_replicas
            ),
            return_exceptions=True,
        )

    async def _send_to_replica(self, replica: ReplicaConnection, message: bytes) -> None:
        async with replica.send_lock:
            websocket = replica.websocket
            if websocket is None:
                return

            try:
                await websocket.send(message)
            except asyncio.CancelledError:
                raise
            except ConnectionClosedOK:
                with suppress(Exception):
                    await websocket.close()
                replica.websocket = None
            except Exception as exc:
                logger.warning("Replica %s send failed: %s", replica.replica_id, exc)
                with suppress(Exception):
                    await websocket.close()
                replica.websocket = None

    async def _handle_replica_connection(self, websocket: Any) -> None:
        path = self._get_connection_path(websocket)
        if path is not None and path != self.config.replica_ingest_path:
            logger.warning("Rejected replica on unexpected path %s", path)
            await websocket.close(code=1008, reason="Invalid path")
            return

        async with self.replica_lock:
            replica = ReplicaConnection(
                replica_id=self.next_replica_id,
                websocket=websocket,
            )
            self.replicas[replica.replica_id] = replica
            self.next_replica_id += 1
            total_connected = len(self.replicas)

        logger.info(
            "Replica %s connected (total=%s)", replica.replica_id, total_connected
        )

        try:
            await websocket.wait_closed()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Replica %s closed with error: %s", replica.replica_id, exc)
        finally:
            async with self.replica_lock:
                self.replicas.pop(replica.replica_id, None)
                total_connected = len(self.replicas)
            with suppress(Exception):
                await websocket.close()
            logger.info(
                "Replica %s disconnected (total=%s)",
                replica.replica_id,
                total_connected,
            )

    def _build_sensor_ws_url(self, websocket_path: str) -> str:
        base = urlsplit(self.config.simulator_base_url)
        ws_base = urlunsplit(
            (
                "wss" if base.scheme == "https" else "ws",
                base.netloc,
                "/",
                "",
                "",
            )
        )
        return urljoin(ws_base, websocket_path)

    def _get_connection_path(self, websocket: Any) -> str | None:
        request = getattr(websocket, "request", None)
        if request is not None:
            return getattr(request, "path", None)
        return getattr(websocket, "path", None)


async def main() -> None:
    broker = Broker(BrokerConfig.from_env())
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, broker.stop_event.set)

    try:
        await broker.run()
    finally:
        await broker.stop()


if __name__ == "__main__":
    try:
        # asyncio.run handles the event loop creation and teardown safely
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info(
            "KeyboardInterrupt received (Ctrl+C). Shutting down broker gracefully..."
        )

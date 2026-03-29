import asyncio
import json
import logging
import os
import signal
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import websockets


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("custom_broker")


@dataclass(slots=True)
class BrokerConfig:
    simulator_base_url: str
    replica_urls: list[str]
    replica_ingest_path: str

    @classmethod
    def from_env(cls) -> "BrokerConfig":
        return cls(
            simulator_base_url=os.getenv("SIMULATOR_BASE_URL", "http://simulator:8080"),
            replica_urls=[
                item.strip()
                for item in os.getenv("REPLICA_URLS", "").split(",")
                if item.strip()
            ],
            replica_ingest_path=os.getenv("REPLICA_INGEST_PATH", "/ws/ingest"),
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
    base_url: str
    ingest_url: str
    connected: bool = False
    websocket: Any = None
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class Broker:
    def __init__(self, config: BrokerConfig) -> None:
        self.config = config
        self.http_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=10.0))
        self.stop_event = asyncio.Event()
        self.sensors: list[Sensor] = []
        self.replicas = [
            ReplicaConnection(
                base_url=replica_url,
                ingest_url=self._build_replica_ingest_url(replica_url),
            )
            for replica_url in config.replica_urls
        ]
        self.tasks: list[asyncio.Task[Any]] = []

    async def run(self) -> None:
        await self._discover_sensors()

        for replica in self.replicas:
            self.tasks.append(
                asyncio.create_task(
                    self._replica_connection_manager(replica),
                    name=f"replica-{replica.base_url}",
                )
            )

        for sensor in self.sensors:
            self.tasks.append(
                asyncio.create_task(
                    self._sensor_listener(sensor),
                    name=f"sensor-{sensor.sensor_id}",
                )
            )

        logger.info(
            "Broker started with %d sensors and %d replicas",
            len(self.sensors),
            len(self.replicas),
        )

        await self.stop_event.wait()

    async def stop(self) -> None:
        self.stop_event.set()

        for task in self.tasks:
            task.cancel()

        for task in self.tasks:
            with suppress(asyncio.CancelledError):
                await task

        for replica in self.replicas:
            if replica.websocket is not None:
                with suppress(Exception):
                    await replica.websocket.close()
                replica.websocket = None
                replica.connected = False

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
        sensor_ws_url = self._build_sensor_ws_url(sensor.websocket_url)
        websocket = None
        try:
            logger.info("Connecting to sensor %s at %s", sensor.sensor_id, sensor_ws_url)
            websocket = await websockets.connect(sensor_ws_url)

            async for raw_message in websocket:
                if isinstance(raw_message, bytes):
                    raw_message = raw_message.decode("utf-8")

                measurement = json.loads(raw_message)
                outgoing = json.dumps(
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
            logger.warning("Sensor %s stream closed: %s", sensor.sensor_id, exc)
        finally:
            if websocket is not None:
                with suppress(Exception):
                    await websocket.close()

    async def _broadcast(self, message: str) -> None:
        connected_replicas = [
            replica
            for replica in self.replicas
            if replica.connected and replica.websocket is not None
        ]

        if not connected_replicas:
            return

        await asyncio.gather(
            *(self._send_to_replica(replica, message) for replica in connected_replicas)
        )

    async def _send_to_replica(self, replica: ReplicaConnection, message: str) -> None:
        async with replica.send_lock:
            websocket = replica.websocket
            if websocket is None or not replica.connected:
                return

            try:
                await websocket.send(message)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Replica %s send failed: %s", replica.base_url, exc)
                replica.connected = False
                with suppress(Exception):
                    await websocket.close()
                replica.websocket = None

    async def _replica_connection_manager(self, replica: ReplicaConnection) -> None:
        websocket = None
        try:
            logger.info("Connecting to replica %s", replica.ingest_url)
            websocket = await websockets.connect(replica.ingest_url)
            replica.websocket = websocket
            replica.connected = True

            await websocket.wait_closed()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Replica %s unavailable: %s", replica.base_url, exc)
        finally:
            if replica.websocket is websocket:
                replica.websocket = None
            replica.connected = False

            if websocket is not None:
                with suppress(Exception):
                    await websocket.close()

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

    def _build_replica_ingest_url(self, replica_base_url: str) -> str:
        base = urlsplit(replica_base_url)
        scheme = {
            "http": "ws",
            "https": "wss",
            "ws": "ws",
            "wss": "wss",
        }.get(base.scheme, "ws")

        ingest_path = self.config.replica_ingest_path
        if not ingest_path.startswith("/"):
            ingest_path = f"/{ingest_path}"

        return urlunsplit((scheme, base.netloc, ingest_path, "", ""))


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
    asyncio.run(main())

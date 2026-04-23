"""
replica.py — Seismic Signal Processing Replica Node
=====================================================
Part of a fault-tolerant, distributed seismic analysis platform.

Responsibilities:
  • Connect to the Broker via WebSocket and receive real-time ground-velocity measurements
  • Maintain a per-sensor sliding window (200 samples) and run DFT-based anomaly detection
  • Forward sensor metadata and detected events to the Gateway via HTTP POST (httpx)
  • Listen for SHUTDOWN commands from the simulator's /api/control SSE endpoint
"""

import asyncio
import hashlib
import logging
import os
import signal
import sys
from collections import deque
from datetime import datetime

import httpx
import numpy as np
import orjson
import websockets
import uvicorn
from fastapi import FastAPI
from httpx_sse import aconnect_sse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("replica")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------
raw_broker_urls = os.getenv("BROKER_URLS") or os.getenv(
    "BROKER_URL", "ws://localhost:9000/ws/ingest"
)
BROKER_URLS = [url.strip() for url in raw_broker_urls.split(",") if url.strip()]
HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8000"))
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8001/api/events")
default_sensor_url = (
    f"{GATEWAY_URL.rsplit('/api/events', 1)[0]}/api/sensors"
    if GATEWAY_URL.endswith("/api/events")
    else "http://localhost:8001/api/sensors"
)
GATEWAY_SENSOR_URL = os.getenv("GATEWAY_SENSOR_URL", default_sensor_url)
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://localhost:8080")
CONTROL_STREAM_ENABLED = os.getenv("CONTROL_STREAM_ENABLED", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

# Sliding-window & analysis parameters
WINDOW_SIZE = int(os.getenv("WINDOW_SIZE", "200"))
AMPLITUDE_THRESHOLD = float(os.getenv("AMPLITUDE_THRESHOLD", "0.01"))  # mm/s

# Overlapping window parameters
STEP_SIZE = int(
    os.getenv("STEP_SIZE", "20")
)  # Run DFT every 20 new samples (1 sec at 20Hz)
COOLDOWN_SAMPLES = int(
    os.getenv("COOLDOWN_SAMPLES", "100")
)  # Wait 5 secs before next detection allowed

# ---------------------------------------------------------------------------
# Shared runtime state
# ---------------------------------------------------------------------------
http_client: httpx.AsyncClient | None = None

# Asyncio event — set when we need to shut down
shutdown_event = asyncio.Event()
http_server: uvicorn.Server | None = None
resolved_http_port = HTTP_PORT
resolved_replica_id = f"replica-{resolved_http_port}"


# ---------------------------------------------------------------------------
# Sensor Processor — encapsulates per-sensor state and DFT analysis
# ---------------------------------------------------------------------------
class SensorProcessor:
    """Manages sliding windows, step/cooldown counters, and sampling rates
    for all sensors. Replaces the previous scattered global dicts."""

    def __init__(
        self,
        window_size: int = WINDOW_SIZE,
        step_size: int = STEP_SIZE,
        cooldown_samples: int = COOLDOWN_SAMPLES,
        amplitude_threshold: float = AMPLITUDE_THRESHOLD,
    ):
        self.window_size = window_size
        self.step_size = step_size
        self.cooldown_samples = cooldown_samples
        self.amplitude_threshold = amplitude_threshold

        # Per-sensor sliding windows  {sensor_id: deque[float]}
        self._windows: dict[str, deque] = {}
        # Tracking counters for the overlapping window
        self._sample_counters: dict[str, int] = {}
        self._cooldown_counters: dict[str, int] = {}
        # Sampling-rate cache  {sensor_id: float}
        self._sampling_rates: dict[str, float] = {}

    def ingest_sample(
        self, sensor_id: str, value: float, sampling_rate: float
    ) -> bool:
        """Add a sample and return True if the window is ready for DFT analysis."""
        self._sampling_rates[sensor_id] = sampling_rate

        if sensor_id not in self._windows:
            self._windows[sensor_id] = deque(maxlen=self.window_size)
            self._sample_counters[sensor_id] = 0
            self._cooldown_counters[sensor_id] = 0

        win = self._windows[sensor_id]
        win.append(value)
        self._sample_counters[sensor_id] += 1

        if self._cooldown_counters[sensor_id] > 0:
            self._cooldown_counters[sensor_id] -= 1

        if len(win) < self.window_size:
            return False

        if self._sample_counters[sensor_id] < self.step_size:
            return False

        # Reset step counter — window is ready
        self._sample_counters[sensor_id] = 0

        if self._cooldown_counters[sensor_id] > 0:
            return False

        return True

    def get_window_snapshot(self, sensor_id: str) -> list[float]:
        """Return a copy of the current sample window for the given sensor."""
        return list(self._windows[sensor_id])

    def get_sampling_rate(self, sensor_id: str) -> float:
        return self._sampling_rates.get(sensor_id, 20.0)

    def activate_cooldown(self, sensor_id: str) -> None:
        self._cooldown_counters[sensor_id] = self.cooldown_samples


# Module-level processor instance
sensor_processor = SensorProcessor()

# Sensors already registered through the gateway
seen_sensors: set[str] = set()


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------
health_app = FastAPI(title="Processing Replica Health")


@health_app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "replica_id": resolved_replica_id,
        "health_url": f"http://{HTTP_HOST}:{resolved_http_port}/health",
        "broker_urls": BROKER_URLS,
        "gateway_url": GATEWAY_URL,
        "gateway_sensor_url": GATEWAY_SENSOR_URL,
    }


# ---------------------------------------------------------------------------
# Gateway forwarding
# ---------------------------------------------------------------------------


def build_sensor_payload(payload: dict) -> dict:
    return {
        "sensor_id": payload.get("sensor_id"),
        "sensor_name": payload.get("sensor_name"),
        "category": payload.get("category"),
        "region": payload.get("region"),
        "coordinates": payload.get("coordinates"),
        "measurement_unit": payload.get("measurement_unit"),
    }


async def register_sensor_with_gateway(payload: dict) -> None:
    """Register static sensor metadata through the gateway once per runtime."""
    sensor_id = payload["sensor_id"]
    if sensor_id in seen_sensors:
        return
    seen_sensors.add(sensor_id)

    try:
        resp = await http_client.post(
            GATEWAY_SENSOR_URL,
            json=build_sensor_payload(payload),
            timeout=5.0,
        )
        resp.raise_for_status()
        log.info("Sensor registered via gateway: %s", sensor_id)
    except Exception as exc:
        log.error("Gateway sensor registration error for %s: %s", sensor_id, exc)
        seen_sensors.discard(sensor_id)


async def forward_to_gateway(event: dict) -> None:
    """POST the event to the gateway, which owns deduplication and persistence."""
    try:
        resp = await http_client.post(GATEWAY_URL, json=event, timeout=5.0)
        resp.raise_for_status()
    except Exception as exc:
        log.error("Gateway forward error: %s", exc)


# ---------------------------------------------------------------------------
# DFT / classification
# ---------------------------------------------------------------------------


def classify_frequency(freq_hz: float) -> str | None:
    """Return event type string or None if frequency is below classification bands."""
    if 0.5 <= freq_hz < 3.0:
        return "earthquake"
    if 3.0 <= freq_hz < 8.0:
        return "conventional_explosion"
    if freq_hz >= 8.0:
        return "nuclear_like"
    return None  # below 0.5 Hz — not classifiable


def build_event_id(sensor_id: str, timestamp: str | datetime, event_type: str) -> str:
    """Build a deterministic event id stable across replica restarts."""
    timestamp_key = timestamp if isinstance(timestamp, str) else timestamp.isoformat()
    raw_key = f"{sensor_id}|{timestamp_key}|{event_type}"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _analyse_window_sync(
    samples: list[float], sampling_rate: float, amplitude_threshold: float
) -> tuple[float, float] | None:
    """
    Run rfft on `samples`, ignore the DC component (index 0),
    and return (dominant_frequency_hz, peak_amplitude) or None
    if the peak amplitude is below the noise threshold.

    This function is CPU-bound and is meant to be called via
    asyncio.to_thread() to avoid blocking the event loop.
    """
    arr = np.array(samples, dtype=np.float64)
    spectrum = np.fft.rfft(arr)
    freqs = np.fft.rfftfreq(len(arr), d=1.0 / sampling_rate)
    amplitudes = np.abs(spectrum)

    # Mask out the DC component and the frequencies out of range
    amplitudes[freqs < 0.5] = 0.0

    peak_idx = int(np.argmax(amplitudes))
    peak_amp = amplitudes[peak_idx]
    peak_freq = freqs[peak_idx]

    if peak_amp < amplitude_threshold:
        return None  # pure noise — do not raise an event

    return float(peak_freq), float(peak_amp)


async def analyse_window(
    samples: list[float], sampling_rate: float
) -> tuple[float, float] | None:
    """Non-blocking wrapper around the CPU-bound FFT analysis."""
    return await asyncio.to_thread(
        _analyse_window_sync, samples, sampling_rate, AMPLITUDE_THRESHOLD
    )


# ---------------------------------------------------------------------------
# Per-message processing
# ---------------------------------------------------------------------------


async def process_message(raw: str) -> None:
    """Parse one WebSocket message, update state, and trigger event pipeline."""
    try:
        payload = orjson.loads(raw)
    except (orjson.JSONDecodeError, ValueError) as exc:
        log.warning("Malformed JSON received: %s", exc)
        return

    sensor_id = payload.get("sensor_id")
    timestamp = payload.get("timestamp")
    value = payload.get("value")
    sampling_rate = payload.get("sampling_rate_hz", 20.0)

    if sensor_id is None or timestamp is None or value is None:
        log.warning("Incomplete payload — skipping: %s", payload)
        return

    asyncio.create_task(register_sensor_with_gateway(payload))

    ready = sensor_processor.ingest_sample(sensor_id, float(value), sampling_rate)
    if not ready:
        return

    samples = sensor_processor.get_window_snapshot(sensor_id)
    result = await analyse_window(samples, sampling_rate)
    if result is None:
        return

    peak_freq, peak_amp = result
    event_type = classify_frequency(peak_freq)
    if event_type is None:
        return

    event_id = build_event_id(sensor_id, timestamp, event_type)

    event = {
        "event_id": event_id,
        "sensor_id": sensor_id,
        "event_type": event_type,
        "last_sample_timestamp": timestamp,
        "peak_frequency": round(peak_freq, 4),
        "peak_amplitude": round(peak_amp, 6),
        "sensor_name": payload.get("sensor_name"),
        "category": payload.get("category"),
        "region": payload.get("region"),
        "coordinates": payload.get("coordinates"),
        "measurement_unit": payload.get("measurement_unit"),
    }

    log.info(
        "EVENT DETECTED — event_id=%s sensor=%s type=%s freq=%.3f Hz amp=%.4f",
        event_id,
        sensor_id,
        event_type,
        peak_freq,
        peak_amp,
    )

    sensor_processor.activate_cooldown(sensor_id)

    # Fire-and-forget: forward without blocking the message processing loop
    asyncio.create_task(forward_to_gateway(event))


# ---------------------------------------------------------------------------
# Broker WebSocket client
# ---------------------------------------------------------------------------


async def consume_broker_stream() -> None:
    """
    Connect to the broker as a WebSocket client and keep retrying until shutdown.
    Consumes the broker stream until shutdown.
    """
    if not BROKER_URLS:
        raise RuntimeError("No broker URL configured. Set BROKER_URL or BROKER_URLS.")

    while not shutdown_event.is_set():
        for broker_url in BROKER_URLS:
            if shutdown_event.is_set():
                return

            try:
                log.info("Connecting to broker at %s", broker_url)
                async with websockets.connect(
                    broker_url,
                    ping_interval=20,
                    ping_timeout=10,
                ) as websocket:
                    log.info("Connected to broker at %s", broker_url)

                    async for message in websocket:
                        if shutdown_event.is_set():
                            return
                        await process_message(message)
            except asyncio.CancelledError:
                raise
            except websockets.ConnectionClosedError as exc:
                log.warning("Broker stream closed from %s: %s", broker_url, exc)
            except OSError as exc:
                log.warning("Broker connection failed for %s: %s", broker_url, exc)
            except Exception as exc:
                log.error("Unexpected broker client error for %s: %s", broker_url, exc)
        await asyncio.sleep(1)


# ---------------------------------------------------------------------------
# SSE control stream — SHUTDOWN listener
# ---------------------------------------------------------------------------


async def listen_control_stream() -> None:
    """
    Connects to the simulator's /api/control SSE endpoint.
    When {"command": "SHUTDOWN"} is received, sets the global shutdown_event.
    Retries on transient connection errors.
    """
    if not CONTROL_STREAM_ENABLED:
        log.info("SSE control stream disabled.")
        return

    control_url = f"{SIMULATOR_URL}/api/control"
    backoff = 1.0

    while not shutdown_event.is_set():
        try:
            async with aconnect_sse(http_client, "GET", control_url) as event_source:
                log.info("SSE control stream connected: %s", control_url)
                backoff = 1.0  # reset on success
                async for sse in event_source.aiter_sse():
                    if shutdown_event.is_set():
                        return
                    if sse.event == "command":
                        try:
                            data = orjson.loads(sse.data)
                        except (orjson.JSONDecodeError, ValueError):
                            continue
                        if data.get("command") == "SHUTDOWN":
                            log.warning(
                                "SHUTDOWN command received — initiating graceful shutdown."
                            )
                            shutdown_event.set()
                            return
        except asyncio.CancelledError:
            raise
        except httpx.ConnectError:
            if shutdown_event.is_set():
                return
            log.warning(
                "SSE control stream unreachable at %s — retrying in %.1fs",
                control_url,
                backoff,
            )
        except (httpx.ReadError, httpx.RemoteProtocolError, httpx.ReadTimeout) as exc:
            if shutdown_event.is_set():
                return
            log.warning("SSE transient error (%s: %s) — retrying in %.1fs",
                        exc.__class__.__name__, exc, backoff)
        except Exception as exc:
            if shutdown_event.is_set():
                return
            error_name = exc.__class__.__name__
            error_detail = str(exc).strip() or "no details"
            log.error(
                "SSE control stream error (%s: %s) — retrying in %.1fs",
                error_name,
                error_detail,
                backoff,
            )
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


# ---------------------------------------------------------------------------
# Replica health server
# ---------------------------------------------------------------------------


async def run_health_server() -> None:
    global http_server
    global resolved_http_port
    global resolved_replica_id

    resolved_http_port = HTTP_PORT
    resolved_replica_id = f"replica-{resolved_http_port}"

    config = uvicorn.Config(
        health_app,
        host=HTTP_HOST,
        port=resolved_http_port,
        log_level="warning",
    )
    http_server = uvicorn.Server(config)
    log.info(
        "Replica health server listening on http://%s:%d/health",
        HTTP_HOST,
        resolved_http_port,
    )
    await http_server.serve()


# ---------------------------------------------------------------------------
# Graceful shutdown helper
# ---------------------------------------------------------------------------


async def graceful_shutdown() -> None:
    """Wait for shutdown signal, then tear down the HTTP client."""
    await shutdown_event.wait()
    log.info("Shutting down — closing resources …")

    if http_client:
        await http_client.aclose()
        log.info("HTTP client closed.")

    if http_server is not None:
        http_server.should_exit = True

    log.info("Replica shut down cleanly.")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def _install_signal_handlers() -> None:
    """Register SIGINT / SIGTERM in a platform-safe way."""

    def _handler(signum, frame):  # noqa: ANN001
        log.info("Signal %s received — requesting shutdown.", signum)
        shutdown_event.set()

    signal.signal(signal.SIGINT, _handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handler)


async def main() -> None:
    global http_client

    # Initialise shared resources
    http_client = httpx.AsyncClient()
    log.info(
        "Replica starting with health=http://%s:%d/health broker=%s gateway=%s sensor_gateway=%s control_stream=%s",
        HTTP_HOST,
        HTTP_PORT,
        BROKER_URLS[0],
        GATEWAY_URL,
        GATEWAY_SENSOR_URL,
        "enabled" if CONTROL_STREAM_ENABLED else "disabled",
    )

    # Launch all background tasks
    tasks = [
        run_health_server(),
        consume_broker_stream(),
        graceful_shutdown(),
    ]
    if CONTROL_STREAM_ENABLED:
        tasks.append(listen_control_stream())

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    _install_signal_handlers()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        shutdown_event.set()
        sys.exit(0)

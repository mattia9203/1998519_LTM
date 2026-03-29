# Custom Broker

Fa tre cose:

1. legge i sensori con `GET /api/devices/`
2. apre una WebSocket per ogni sensore usando `websocket_url`
3. fa broadcast di ogni misura a tutte le repliche connesse

## Contratto usato

Dal simulatore:

- `GET /api/devices/` restituisce una lista di sensori
- ogni sensore contiene `websocket_url`
- ogni stream invia messaggi con:

```json
{
  "timestamp": "2026-03-25T00:00:00.000000+00:00",
  "value": 0.123456
}
```

Verso ogni replica il broker invia:

```json
{
  "sensor_id": "sensor-08",
  "sensor_name": "DC North Perimeter",
  "category": "datacenter",
  "region": "Replica Datacenter",
  "coordinates": {
    "latitude": 45.4642,
    "longitude": 9.19
  },
  "measurement_unit": "mm/s",
  "sampling_rate_hz": 20.0,
  "timestamp": "2026-03-25T00:00:00.000000+00:00",
  "value": 0.123456
}
```

## Variabili ambiente

- `SIMULATOR_BASE_URL` default `http://simulator:8080`
- `REPLICA_URLS` lista separata da virgole, per esempio `ws://processing-1:9000,ws://processing-2:9000`
- `REPLICA_INGEST_PATH` default `/ws/ingest`

## Avvio locale

```bash
cd source/custom-broker
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Docker

```bash
docker build -t custom-broker ./source/custom-broker
docker run --rm \
  -e SIMULATOR_BASE_URL=http://simulator:8080 \
  -e REPLICA_URLS=ws://processing-1:9000,ws://processing-2:9000,ws://processing-3:9000 \
  custom-broker
```

## Esempio docker-compose

```yaml
custom-broker:
  build:
    context: ./custom-broker
  environment:
    SIMULATOR_BASE_URL: http://simulator:8080
    REPLICA_URLS: ws://processing-1:9000,ws://processing-2:9000,ws://processing-3:9000
    REPLICA_INGEST_PATH: /ws/ingest
```

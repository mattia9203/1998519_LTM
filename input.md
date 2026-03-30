# SYSTEM DESCRIPTION:

The project is a distributed, fault-tolerant seismic analysis platform.

Its purpose is to ingest live seismic measurements from an external simulator, redistribute them through a custom broker, process them through replicated analysis nodes, classify suspicious seismic activity through frequency analysis, persist detected events in a duplicate-safe way, and expose both live and historical information through a real-time dashboard.

The implemented system is based on the following architectural principles:

- a custom broker that only captures and redistributes measurements
- multiple identical processing replicas
    - sliding-window analysis on each replica
    - FFT-based frequency detection
    - duplicate-safe persistence
- a single gateway exposed to the frontend
- a dashboard for real-time monitoring, historical investigation, and replica health
- full deployment through `docker compose up`

Relevant LoFi mockups are available in `booklets/mockup/` and cover the main dashboard views: Sensors, Historical Events, Event Details, and System Health.

# USER STORIES:

## Operator

### Network Visibility and Situational Awareness

1) As an Operator, I want to see all available seismic sensors in the dashboard, so that I can understand which sources are monitored by the platform.
2) As an Operator, I want to see the category of each sensor, so that I can distinguish field sensors from datacenter sensors.
3) As an Operator, I want to see the region and coordinates of each sensor, so that I can understand the geographic context of the monitored network.
4) As an Operator, I want to know whether the real-time measurements are online or not, so that I can easily see if the data I am seeing is recent or stale.
5) As an Operator, I want to see the last detected event of each sensor, so that I can react quickly to suspicious activity.
6) As an Operator, I want to see the last dominant frequency detected for each sensor, so that I can evaluate the gravity of the event.

### Event Inspection and Historical Analysis

7) As an Operator, I want to open the details of a detected event, so that I can inspect sensor, timestamps, frequency, and classification in one place.
8) As an Operator, I want to see the peak amplitude of each detected event, so that I can estimate how strong the seismic wave was.
9) As an Operator, I want to see the exact timestamp of each detected event, so that I can understand when the seismic disturbance occurred.
10) As an Operator, I want to access the historical list of detected events, so that I can inspect past seismic activity after the live moment has passed.
11) As an Operator, I want to be able to see historical events even if the measurements are offline, so that I can always check past events.
12) As an Operator, I want to filter historical events to earthquakes, conventional explosions or nuclear-like events, so that I can analyze which location is more prone to which event.
13) As an Operator, I want to filter historical events by sensor, so that I can investigate the activity associated with a specific seismic device.
14) As an Operator, I want to filter historical events by region, so that I can focus my analysis on a specific geographic area.
15) As an Operator, I want to filter historical events by peak amplitude, so that I can focus my analysis on the strongest threats.

## Administrator

### System Monitoring and Fault Tolerance

16) As an Administrator, I want to see the current live monitoring status in the dashboard, so that I can quickly understand whether the system is operating correctly.
17) As an Administrator, I want the historical event list to show only one consolidated record for each detected event, so that the event history remains clear and free of duplicates.
18) As an Administrator, I want to see the status of all processing replicas in the dashboard, so that I can immediately identify which nodes are currently available.
19) As an Administrator, I want the dashboard to highlight the timestamp when a processing replica becomes unavailable, so that node failures are clearly traceable.
20) As an Administrator, I want the dashboard to remain usable when one processing replica fails, so that I can continue monitoring the system without interruption.

# STANDARD INTERNAL EVENT SCHEMA:

The system uses two internal message structures:

- a normalized measurement envelope broadcast by the broker to all processing replicas
- a detected event envelope emitted by the replicas toward the gateway

## Measurement Envelope

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

Field meaning:

- `sensor_id`: stable sensor identifier obtained from simulator discovery
- `sensor_name`: human-readable sensor label
- `category`: sensor category, either `field` or `datacenter`
- `region`: logical geographic region
- `coordinates`: latitude and longitude of the sensor
- `measurement_unit`: unit of the sampled value
- `sampling_rate_hz`: sampling frequency used by the replica FFT
- `timestamp`: UTC ISO-8601 timestamp of the sample
- `value`: signed seismic measurement value

## Detected Event Envelope

When a replica classifies a seismic disturbance, it emits the following payload toward the gateway:

```json
{
  "event_id": "sha256(sensor_id|timestamp|event_type)",
  "sensor_id": "sensor-08",
  "event_type": "earthquake",
  "last_sample_timestamp": "2026-03-25T00:00:09.950000+00:00",
  "peak_frequency": 1.6,
  "peak_amplitude": 4.0
}
```

Field meaning:

- `event_id`: deterministic identifier used for deduplication
- `sensor_id`: originating sensor
- `event_type`: `earthquake`, `conventional_explosion`, or `nuclear_like`
- `last_sample_timestamp`: timestamp of the last sample in the analyzed window
- `peak_frequency`: dominant frequency extracted from FFT analysis
- `peak_amplitude`: dominant spectral amplitude associated with the detected event

# RULE MODEL:

The rule model is a fixed frequency-based classification model.

## Detection Logic

- each processing replica maintains an independent sliding window for each sensor
- FFT is executed on overlapping windows of 200 samples with a step of 20 samples
- values below the configured amplitude threshold are treated as noise
- frequencies below `0.5 Hz` are ignored for classification

## Classification Rules

- `0.5 <= f < 3.0 Hz` -> `earthquake`
- `3.0 <= f < 8.0 Hz` -> `conventional_explosion`
- `f >= 8.0 Hz` -> `nuclear_like`

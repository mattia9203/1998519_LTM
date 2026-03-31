const EVENT_TYPE_LABELS = {
  earthquake: "Earthquake",
  conventional_explosion: "Conv. Explosion",
  nuclear_like: "Nuclear-like",
};

const EVENT_TYPE_PILL_CLASSES = {
  earthquake: "pill--event-earthquake",
  conventional_explosion: "pill--event-explosion",
  nuclear_like: "pill--event-nuclear",
};

export const EVENT_TYPE_OPTIONS = [
  { value: "", label: "Earthquake / Explosion / Nuclear" },
  { value: "earthquake", label: "Earthquake" },
  { value: "conventional_explosion", label: "Conv. Explosion" },
  { value: "nuclear_like", label: "Nuclear-like" },
];

const pad = (value) => String(value).padStart(2, "0");

const asDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const eventTypeLabel = (type) =>
  EVENT_TYPE_LABELS[type] || "Unknown event";

export const eventTypeBadge = (type) => eventTypeLabel(type).toUpperCase();

export const eventTypePillClass = (type) =>
  EVENT_TYPE_PILL_CLASSES[type] || "";

export const categoryLabel = (value) => {
  if (!value) {
    return "UNKNOWN";
  }

  return value.toUpperCase();
};

export const categoryName = (value) => {
  if (!value) {
    return "Unknown";
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

export const sensorDisplayId = (value) => {
  if (!value) {
    return "UNKNOWN";
  }

  return value.toUpperCase();
};

export const formatCoordinates = (latitude, longitude) => {
  if (latitude == null || longitude == null) {
    return "N/A";
  }

  return `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}`;
};

export const formatFrequency = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${Number(value).toFixed(1)} Hz`;
};

export const formatAmplitude = (value, unit = "mm/s") => {
  if (value == null || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${Number(value).toFixed(1)} ${unit}`;
};

export const formatEventDisplayId = (value, visibleLength = 10) => {
  if (!value) {
    return "N/A";
  }

  return String(value).slice(0, visibleLength);
};

export const formatCompactTimestamp = (value) => {
  const parsed = asDate(value);

  if (!parsed) {
    return "N/A";
  }

  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
};

export const formatUtcTimestamp = (value) => {
  const parsed = asDate(value);

  if (!parsed) {
    return "N/A";
  }

  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())} UTC`;
};

export const replicaLabel = (_, index) =>
  `REP-${String(index + 1).padStart(2, "0")}`;

export const buildHistorySearch = (filters) => {
  const params = new URLSearchParams();

  if (filters.event_type) {
    params.set("event_type", filters.event_type);
  }

  if (filters.sensor_id) {
    params.set("sensor_id", filters.sensor_id);
  }

  if (filters.region) {
    params.set("region", filters.region);
  }

  if (filters.minAmplitude) {
    params.set("minAmplitude", filters.minAmplitude);
  }

  return params;
};

export const matchesHistoryFilters = (event, filters) => {
  if (filters.event_type && event.event_type !== filters.event_type) {
    return false;
  }

  if (filters.sensor_id && event.sensor_id !== filters.sensor_id) {
    return false;
  }

  if (filters.region && event.region !== filters.region) {
    return false;
  }

  if (
    filters.minAmplitude &&
    Number(event.peak_amplitude || 0) < Number(filters.minAmplitude)
  ) {
    return false;
  }

  return true;
};

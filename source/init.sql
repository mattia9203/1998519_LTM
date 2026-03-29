
CREATE TABLE IF NOT EXISTS sensors (
    sensor_id VARCHAR(50) PRIMARY KEY,
    region VARCHAR(100),
    latitude DOUBLE PRECISION,     
    longitude DOUBLE PRECISION,
    category VARCHAR(50),          
    sampling_rate_hz DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS seismic_events (
    event_id VARCHAR(100),
    frequence DOUBLE PRECISION,    
    event_timestamp TIMESTAMPTZ,   

    sensor_id VARCHAR(50),         
    event_type VARCHAR(50),        
    amplitude DOUBLE PRECISION,
    duration_seconds DOUBLE PRECISION,

    PRIMARY KEY (event_id, frequence, event_timestamp)
);
// Package config provides configuration loading from environment variables
// for the Electric sync service.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all server configuration loaded from environment variables.
type Config struct {
	// DatabaseURL is the PostgreSQL connection string (required).
	DatabaseURL string

	// Port is the HTTP server port (default: 3000).
	Port int

	// LongPollTimeout is the timeout for live mode requests (default: 20s).
	LongPollTimeout time.Duration

	// ChunkThreshold is the size threshold for creating new chunks in bytes (default: 10MB).
	ChunkThreshold int

	// MaxAge is the cache max-age for immutable chunks in seconds (default: 604800 = 1 week).
	// Note: This applies to immutable/completed chunks. Catch-up responses for active
	// shapes may use different caching strategies (typically shorter or no caching).
	MaxAge int

	// StaleAge is the stale-while-revalidate duration in seconds (default: 300 = 5 min).
	StaleAge int

	// StorageDir is the directory for SQLite storage (default: "./electric_data").
	StorageDir string

	// ReplicationSlot is the PostgreSQL replication slot name (default: "electric_replication").
	ReplicationSlot string

	// Publication is the PostgreSQL publication name (default: "electric_publication").
	Publication string

	// Secret is the API authentication token (optional, empty means no auth).
	Secret string

	// DBPoolSize is the PostgreSQL connection pool size (default: 20).
	DBPoolSize int

	// MaxShapes is the maximum number of simultaneous shapes (0 = unlimited).
	MaxShapes int
}

// Default values for configuration.
const (
	DefaultPort              = 3000
	DefaultLongPollTimeoutMs = 20000
	DefaultChunkThreshold    = 10485760 // 10MB
	DefaultMaxAge            = 604800   // 1 week in seconds
	DefaultStaleAge          = 300      // 5 minutes in seconds
	DefaultStorageDir        = "./electric_data"
	DefaultReplicationSlot   = "electric_replication"
	DefaultPublication       = "electric_publication"
	DefaultDBPoolSize        = 20
	DefaultMaxShapes         = 0 // 0 = unlimited
)

// Environment variable names.
const (
	EnvDatabaseURL     = "DATABASE_URL"
	EnvPort            = "ELECTRIC_PORT"
	EnvLongPollTimeout = "ELECTRIC_LONG_POLL_TIMEOUT"
	EnvChunkThreshold  = "ELECTRIC_CHUNK_THRESHOLD"
	EnvMaxAge          = "ELECTRIC_MAX_AGE"
	EnvStaleAge        = "ELECTRIC_STALE_AGE"
	EnvStorageDir      = "ELECTRIC_STORAGE_DIR"
	EnvReplicationSlot = "ELECTRIC_REPLICATION_SLOT"
	EnvPublication     = "ELECTRIC_PUBLICATION"
	EnvSecret          = "ELECTRIC_SECRET"
	EnvDBPoolSize      = "ELECTRIC_DB_POOL_SIZE"
	EnvMaxShapes       = "ELECTRIC_MAX_SHAPES"
)

// ValidationError represents a configuration validation error.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("config validation error: %s: %s", e.Field, e.Message)
}

// Load reads configuration from environment variables with sensible defaults.
// It returns an error if validation fails.
func Load() (*Config, error) {
	cfg := &Config{
		DatabaseURL:     os.Getenv(EnvDatabaseURL),
		Port:            DefaultPort,
		LongPollTimeout: time.Duration(DefaultLongPollTimeoutMs) * time.Millisecond,
		ChunkThreshold:  DefaultChunkThreshold,
		MaxAge:          DefaultMaxAge,
		StaleAge:        DefaultStaleAge,
		StorageDir:      DefaultStorageDir,
		ReplicationSlot: DefaultReplicationSlot,
		Publication:     DefaultPublication,
		Secret:          os.Getenv(EnvSecret),
		DBPoolSize:      DefaultDBPoolSize,
		MaxShapes:       DefaultMaxShapes,
	}

	// Parse Port
	if val := os.Getenv(EnvPort); val != "" {
		port, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvPort, Message: "must be a valid integer"}
		}
		cfg.Port = port
	}

	// Parse LongPollTimeout (in milliseconds)
	if val := os.Getenv(EnvLongPollTimeout); val != "" {
		ms, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvLongPollTimeout, Message: "must be a valid integer"}
		}
		cfg.LongPollTimeout = time.Duration(ms) * time.Millisecond
	}

	// Parse ChunkThreshold
	if val := os.Getenv(EnvChunkThreshold); val != "" {
		threshold, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvChunkThreshold, Message: "must be a valid integer"}
		}
		cfg.ChunkThreshold = threshold
	}

	// Parse MaxAge
	if val := os.Getenv(EnvMaxAge); val != "" {
		maxAge, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvMaxAge, Message: "must be a valid integer"}
		}
		cfg.MaxAge = maxAge
	}

	// Parse StaleAge
	if val := os.Getenv(EnvStaleAge); val != "" {
		staleAge, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvStaleAge, Message: "must be a valid integer"}
		}
		cfg.StaleAge = staleAge
	}

	// Parse StorageDir
	if val := os.Getenv(EnvStorageDir); val != "" {
		cfg.StorageDir = val
	}

	// Parse ReplicationSlot
	if val := os.Getenv(EnvReplicationSlot); val != "" {
		cfg.ReplicationSlot = val
	}

	// Parse Publication
	if val := os.Getenv(EnvPublication); val != "" {
		cfg.Publication = val
	}

	// Parse DBPoolSize
	if val := os.Getenv(EnvDBPoolSize); val != "" {
		poolSize, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvDBPoolSize, Message: "must be a valid integer"}
		}
		cfg.DBPoolSize = poolSize
	}

	// Parse MaxShapes
	if val := os.Getenv(EnvMaxShapes); val != "" {
		maxShapes, err := strconv.Atoi(val)
		if err != nil {
			return nil, &ValidationError{Field: EnvMaxShapes, Message: "must be a valid integer"}
		}
		cfg.MaxShapes = maxShapes
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// Validate checks that the configuration is valid.
// It returns the first validation error encountered, if any.
func (c *Config) Validate() error {
	var errs []error

	// DATABASE_URL is required
	if c.DatabaseURL == "" {
		errs = append(errs, &ValidationError{Field: EnvDatabaseURL, Message: "is required"})
	}

	// Port must be valid (1-65535)
	if c.Port < 1 || c.Port > 65535 {
		errs = append(errs, &ValidationError{Field: EnvPort, Message: "must be between 1 and 65535"})
	}

	// LongPollTimeout must be positive
	if c.LongPollTimeout <= 0 {
		errs = append(errs, &ValidationError{Field: EnvLongPollTimeout, Message: "must be positive"})
	}

	// ChunkThreshold must be positive
	if c.ChunkThreshold <= 0 {
		errs = append(errs, &ValidationError{Field: EnvChunkThreshold, Message: "must be positive"})
	}

	// MaxAge must be non-negative
	if c.MaxAge < 0 {
		errs = append(errs, &ValidationError{Field: EnvMaxAge, Message: "must be non-negative"})
	}

	// StaleAge must be non-negative
	if c.StaleAge < 0 {
		errs = append(errs, &ValidationError{Field: EnvStaleAge, Message: "must be non-negative"})
	}

	// StorageDir must not be empty
	if c.StorageDir == "" {
		errs = append(errs, &ValidationError{Field: EnvStorageDir, Message: "must not be empty"})
	}

	// ReplicationSlot must not be empty
	if c.ReplicationSlot == "" {
		errs = append(errs, &ValidationError{Field: EnvReplicationSlot, Message: "must not be empty"})
	}

	// Publication must not be empty
	if c.Publication == "" {
		errs = append(errs, &ValidationError{Field: EnvPublication, Message: "must not be empty"})
	}

	// DBPoolSize must be at least 1
	if c.DBPoolSize < 1 {
		errs = append(errs, &ValidationError{Field: EnvDBPoolSize, Message: "must be at least 1"})
	}

	// MaxShapes must be non-negative (0 = unlimited)
	if c.MaxShapes < 0 {
		errs = append(errs, &ValidationError{Field: EnvMaxShapes, Message: "must be non-negative"})
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}

	return nil
}

// LongPollTimeoutMs returns the long poll timeout in milliseconds as an integer.
// This is useful for APIs that expect milliseconds.
func (c *Config) LongPollTimeoutMs() int {
	return int(c.LongPollTimeout.Milliseconds())
}

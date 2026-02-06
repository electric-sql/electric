package config

import (
	"os"
	"strings"
	"testing"
	"time"
)

// Helper to set environment variables and restore them after the test.
func setEnvVars(t *testing.T, vars map[string]string) func() {
	t.Helper()

	// Store original values
	original := make(map[string]string)
	wasSet := make(map[string]bool)

	for k := range vars {
		if val, ok := os.LookupEnv(k); ok {
			original[k] = val
			wasSet[k] = true
		} else {
			wasSet[k] = false
		}
	}

	// Set new values
	for k, v := range vars {
		if v == "" {
			os.Unsetenv(k)
		} else {
			os.Setenv(k, v)
		}
	}

	// Return cleanup function
	return func() {
		for k := range vars {
			if wasSet[k] {
				os.Setenv(k, original[k])
			} else {
				os.Unsetenv(k)
			}
		}
	}
}

// clearEnvVars unsets all config-related environment variables.
func clearEnvVars(t *testing.T) func() {
	t.Helper()

	vars := []string{
		EnvDatabaseURL,
		EnvPort,
		EnvLongPollTimeout,
		EnvChunkThreshold,
		EnvMaxAge,
		EnvStaleAge,
		EnvStorageDir,
		EnvReplicationSlot,
		EnvPublication,
	}

	envMap := make(map[string]string)
	for _, v := range vars {
		envMap[v] = ""
	}

	return setEnvVars(t, envMap)
}

func TestLoad_Defaults(t *testing.T) {
	cleanup := clearEnvVars(t)
	defer cleanup()

	// Set required DATABASE_URL
	os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
	defer os.Unsetenv(EnvDatabaseURL)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}

	// Check default values
	if cfg.Port != DefaultPort {
		t.Errorf("Port = %d, want %d", cfg.Port, DefaultPort)
	}

	expectedTimeout := time.Duration(DefaultLongPollTimeoutMs) * time.Millisecond
	if cfg.LongPollTimeout != expectedTimeout {
		t.Errorf("LongPollTimeout = %v, want %v", cfg.LongPollTimeout, expectedTimeout)
	}

	if cfg.ChunkThreshold != DefaultChunkThreshold {
		t.Errorf("ChunkThreshold = %d, want %d", cfg.ChunkThreshold, DefaultChunkThreshold)
	}

	if cfg.MaxAge != DefaultMaxAge {
		t.Errorf("MaxAge = %d, want %d", cfg.MaxAge, DefaultMaxAge)
	}

	if cfg.StaleAge != DefaultStaleAge {
		t.Errorf("StaleAge = %d, want %d", cfg.StaleAge, DefaultStaleAge)
	}

	if cfg.StorageDir != DefaultStorageDir {
		t.Errorf("StorageDir = %q, want %q", cfg.StorageDir, DefaultStorageDir)
	}

	if cfg.ReplicationSlot != DefaultReplicationSlot {
		t.Errorf("ReplicationSlot = %q, want %q", cfg.ReplicationSlot, DefaultReplicationSlot)
	}

	if cfg.Publication != DefaultPublication {
		t.Errorf("Publication = %q, want %q", cfg.Publication, DefaultPublication)
	}
}

func TestLoad_CustomValues(t *testing.T) {
	cleanup := setEnvVars(t, map[string]string{
		EnvDatabaseURL:     "postgres://user:pass@host:5432/db",
		EnvPort:            "8080",
		EnvLongPollTimeout: "30000",
		EnvChunkThreshold:  "5242880",
		EnvMaxAge:          "3600",
		EnvStaleAge:        "600",
		EnvStorageDir:      "/data/electric",
		EnvReplicationSlot: "my_slot",
		EnvPublication:     "my_publication",
	})
	defer cleanup()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}

	if cfg.DatabaseURL != "postgres://user:pass@host:5432/db" {
		t.Errorf("DatabaseURL = %q, want %q", cfg.DatabaseURL, "postgres://user:pass@host:5432/db")
	}

	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want %d", cfg.Port, 8080)
	}

	if cfg.LongPollTimeout != 30*time.Second {
		t.Errorf("LongPollTimeout = %v, want %v", cfg.LongPollTimeout, 30*time.Second)
	}

	if cfg.ChunkThreshold != 5242880 {
		t.Errorf("ChunkThreshold = %d, want %d", cfg.ChunkThreshold, 5242880)
	}

	if cfg.MaxAge != 3600 {
		t.Errorf("MaxAge = %d, want %d", cfg.MaxAge, 3600)
	}

	if cfg.StaleAge != 600 {
		t.Errorf("StaleAge = %d, want %d", cfg.StaleAge, 600)
	}

	if cfg.StorageDir != "/data/electric" {
		t.Errorf("StorageDir = %q, want %q", cfg.StorageDir, "/data/electric")
	}

	if cfg.ReplicationSlot != "my_slot" {
		t.Errorf("ReplicationSlot = %q, want %q", cfg.ReplicationSlot, "my_slot")
	}

	if cfg.Publication != "my_publication" {
		t.Errorf("Publication = %q, want %q", cfg.Publication, "my_publication")
	}
}

func TestLoad_DatabaseURLRequired(t *testing.T) {
	cleanup := clearEnvVars(t)
	defer cleanup()

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want error for missing DATABASE_URL")
	}

	var validErr *ValidationError
	if !strings.Contains(err.Error(), EnvDatabaseURL) {
		t.Errorf("error should mention %s, got: %v", EnvDatabaseURL, err)
	}

	// Check that it's a validation error for DATABASE_URL
	if !strings.Contains(err.Error(), "is required") {
		t.Errorf("error should mention 'is required', got: %v", err)
	}
	_ = validErr
}

func TestLoad_InvalidPort(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		wantErr bool
	}{
		{"valid port", "3000", false},
		{"min valid port", "1", false},
		{"max valid port", "65535", false},
		{"non-numeric", "abc", true},
		{"empty string", "", false},  // Uses default
		{"negative", "-1", true},     // Will fail validation
		{"zero", "0", true},          // Will fail validation
		{"too large", "65536", true}, // Will fail validation
		{"float", "3000.5", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			if tt.port != "" {
				os.Setenv(EnvPort, tt.port)
			}

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Errorf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoad_InvalidLongPollTimeout(t *testing.T) {
	tests := []struct {
		name    string
		timeout string
		wantErr bool
	}{
		{"valid timeout", "20000", false},
		{"one millisecond", "1", false},
		{"non-numeric", "abc", true},
		{"empty string", "", false}, // Uses default
		{"zero", "0", true},         // Will fail validation
		{"negative", "-1000", true}, // Will fail validation
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			if tt.timeout != "" {
				os.Setenv(EnvLongPollTimeout, tt.timeout)
			}

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Errorf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoad_InvalidChunkThreshold(t *testing.T) {
	tests := []struct {
		name      string
		threshold string
		wantErr   bool
	}{
		{"valid threshold", "10485760", false},
		{"one byte", "1", false},
		{"non-numeric", "10MB", true},
		{"empty string", "", false}, // Uses default
		{"zero", "0", true},         // Will fail validation
		{"negative", "-1024", true}, // Will fail validation
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			if tt.threshold != "" {
				os.Setenv(EnvChunkThreshold, tt.threshold)
			}

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Errorf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoad_InvalidMaxAge(t *testing.T) {
	tests := []struct {
		name    string
		maxAge  string
		wantErr bool
	}{
		{"valid max age", "604800", false},
		{"zero", "0", false}, // Zero is valid (no caching)
		{"non-numeric", "1w", true},
		{"empty string", "", false}, // Uses default
		{"negative", "-1", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			if tt.maxAge != "" {
				os.Setenv(EnvMaxAge, tt.maxAge)
			}

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Errorf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoad_InvalidStaleAge(t *testing.T) {
	tests := []struct {
		name     string
		staleAge string
		wantErr  bool
	}{
		{"valid stale age", "300", false},
		{"zero", "0", false}, // Zero is valid
		{"non-numeric", "5m", true},
		{"empty string", "", false}, // Uses default
		{"negative", "-60", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			if tt.staleAge != "" {
				os.Setenv(EnvStaleAge, tt.staleAge)
			}

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Errorf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidate_AllFields(t *testing.T) {
	tests := []struct {
		name    string
		config  Config
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid config",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: false,
		},
		{
			name: "missing database url",
			config: Config{
				DatabaseURL:     "",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "DATABASE_URL",
		},
		{
			name: "port too low",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            0,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_PORT",
		},
		{
			name: "port too high",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            70000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_PORT",
		},
		{
			name: "zero timeout",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 0,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_LONG_POLL_TIMEOUT",
		},
		{
			name: "negative timeout",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: -1 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_LONG_POLL_TIMEOUT",
		},
		{
			name: "zero chunk threshold",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  0,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_CHUNK_THRESHOLD",
		},
		{
			name: "negative max age",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          -1,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_MAX_AGE",
		},
		{
			name: "negative stale age",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        -1,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_STALE_AGE",
		},
		{
			name: "empty storage dir",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "",
				ReplicationSlot: "slot",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_STORAGE_DIR",
		},
		{
			name: "empty replication slot",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "",
				Publication:     "pub",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_REPLICATION_SLOT",
		},
		{
			name: "empty publication",
			config: Config{
				DatabaseURL:     "postgres://localhost/test",
				Port:            3000,
				LongPollTimeout: 20 * time.Second,
				ChunkThreshold:  10485760,
				MaxAge:          604800,
				StaleAge:        300,
				StorageDir:      "./data",
				ReplicationSlot: "slot",
				Publication:     "",
			},
			wantErr: true,
			errMsg:  "ELECTRIC_PUBLICATION",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr && tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
				t.Errorf("Validate() error = %v, want error containing %q", err, tt.errMsg)
			}
		})
	}
}

func TestValidate_MultipleErrors(t *testing.T) {
	cfg := Config{
		DatabaseURL:     "",
		Port:            0,
		LongPollTimeout: 0,
		ChunkThreshold:  0,
		MaxAge:          -1,
		StaleAge:        -1,
		StorageDir:      "",
		ReplicationSlot: "",
		Publication:     "",
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil, want error")
	}

	// Should contain multiple errors
	errStr := err.Error()
	expectedFields := []string{
		EnvDatabaseURL,
		EnvPort,
		EnvLongPollTimeout,
		EnvChunkThreshold,
		EnvMaxAge,
		EnvStaleAge,
		EnvStorageDir,
		EnvReplicationSlot,
		EnvPublication,
	}

	for _, field := range expectedFields {
		if !strings.Contains(errStr, field) {
			t.Errorf("Validate() error should contain %q, got: %v", field, errStr)
		}
	}
}

func TestLongPollTimeoutMs(t *testing.T) {
	tests := []struct {
		timeout time.Duration
		want    int
	}{
		{20 * time.Second, 20000},
		{time.Millisecond, 1},
		{30 * time.Second, 30000},
		{100 * time.Millisecond, 100},
		{time.Minute, 60000},
	}

	for _, tt := range tests {
		t.Run(tt.timeout.String(), func(t *testing.T) {
			cfg := &Config{LongPollTimeout: tt.timeout}
			got := cfg.LongPollTimeoutMs()
			if got != tt.want {
				t.Errorf("LongPollTimeoutMs() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestValidationError_Error(t *testing.T) {
	err := &ValidationError{
		Field:   "TEST_FIELD",
		Message: "is invalid",
	}

	expected := "config validation error: TEST_FIELD: is invalid"
	if err.Error() != expected {
		t.Errorf("Error() = %q, want %q", err.Error(), expected)
	}
}

func TestLoad_PortBoundaries(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		want    int
		wantErr bool
	}{
		{"port 1", "1", 1, false},
		{"port 80", "80", 80, false},
		{"port 443", "443", 443, false},
		{"port 3000", "3000", 3000, false},
		{"port 8080", "8080", 8080, false},
		{"port 65535", "65535", 65535, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			os.Setenv(EnvPort, tt.port)

			cfg, err := Load()
			if (err != nil) != tt.wantErr {
				t.Errorf("Load() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr && cfg.Port != tt.want {
				t.Errorf("Port = %d, want %d", cfg.Port, tt.want)
			}
		})
	}
}

func TestLoad_StorageDir_Various(t *testing.T) {
	tests := []struct {
		name string
		dir  string
		want string
	}{
		{"relative path", "./data", "./data"},
		{"absolute path", "/var/lib/electric", "/var/lib/electric"},
		{"nested path", "/home/user/electric/data", "/home/user/electric/data"},
		{"current dir", ".", "."},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, "postgres://localhost/test")
			os.Setenv(EnvStorageDir, tt.dir)

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}

			if cfg.StorageDir != tt.want {
				t.Errorf("StorageDir = %q, want %q", cfg.StorageDir, tt.want)
			}
		})
	}
}

func TestLoad_DatabaseURL_Various(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"basic", "postgres://localhost/test"},
		{"with port", "postgres://localhost:5432/test"},
		{"with user", "postgres://user@localhost/test"},
		{"with password", "postgres://user:pass@localhost/test"},
		{"with params", "postgres://localhost/test?sslmode=disable"},
		{"full URL", "postgres://user:pass@host.example.com:5432/database?sslmode=require"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := clearEnvVars(t)
			defer cleanup()

			os.Setenv(EnvDatabaseURL, tt.url)

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}

			if cfg.DatabaseURL != tt.url {
				t.Errorf("DatabaseURL = %q, want %q", cfg.DatabaseURL, tt.url)
			}
		})
	}
}

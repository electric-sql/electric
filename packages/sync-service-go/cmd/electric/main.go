// Package main provides the entry point for the Electric sync service.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/api"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/config"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/shapecache"
	"github.com/electric-sql/electric/packages/sync-service-go/pkg/storage/memory"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("Error: %v", err)
	}
}

// run executes the main server logic and returns any error.
// This is separated from main() to facilitate testing.
func run() error {
	// 1. Load config from environment
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// 2. Validate config (Load already validates, but we can double-check)
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	// 3. Create storage (memory for now)
	store := memory.NewDefault()

	// 4. Create shape cache with config
	cacheConfig := shapecache.CacheConfig{
		ChunkThreshold: int64(cfg.ChunkThreshold),
	}
	cache := shapecache.NewCacheWithConfig(store, cacheConfig)

	// 5. Create HTTP router
	router := api.NewRouter(cache, store, cfg)

	// 6. Create HTTP server
	// WriteTimeout must be longer than LongPollTimeout to allow long-poll responses to complete
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: cfg.LongPollTimeout + 10*time.Second,
	}

	// 7. Handle graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
		<-sigCh

		log.Println("Shutting down server...")

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()

	// 8. Start server
	log.Printf("Electric sync service starting on port %d", cfg.Port)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}

	log.Println("Server stopped")
	return nil
}

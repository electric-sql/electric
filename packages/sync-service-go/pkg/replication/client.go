// Package replication provides a PostgreSQL logical replication client
// that manages WAL streaming and message parsing.
//
// Ported from: lib/electric/postgres/replication_client.ex
package replication

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/electric-sql/electric/packages/sync-service-go/pkg/wal"
	"github.com/jackc/pglogrepl"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgproto3"
)

// PostgreSQL replication message types
const (
	msgPrimaryKeepalive = 'k'
	msgXLogData         = 'w'
)

// PostgreSQL epoch (2000-01-01 00:00:00 UTC) in microseconds
var pgEpoch = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)

// ClientConfig configures the replication client.
type ClientConfig struct {
	// ConnString is the PostgreSQL connection string.
	// Must include replication=database parameter for replication connections.
	ConnString string

	// SlotName is the name of the replication slot to use.
	SlotName string

	// Publication is the name of the publication to stream from.
	Publication string

	// StartLSN is the LSN position to start streaming from.
	// Use 0 to start from the slot's confirmed_flush_lsn.
	StartLSN pglogrepl.LSN

	// StandbyMessageTimeout is the interval for sending standby status updates.
	// Defaults to 10 seconds if not set.
	StandbyMessageTimeout time.Duration
}

// Client manages PostgreSQL logical replication.
type Client struct {
	config ClientConfig
	conn   *pgconn.PgConn
	parser *wal.Parser

	mu      sync.RWMutex
	running bool
	stopCh  chan struct{}

	// LSN tracking for standby status updates
	receivedLSN pglogrepl.LSN
	flushedLSN  pglogrepl.LSN
	appliedLSN  pglogrepl.LSN
}

// NewClient creates a new replication client.
func NewClient(config ClientConfig) *Client {
	if config.StandbyMessageTimeout == 0 {
		config.StandbyMessageTimeout = 10 * time.Second
	}

	return &Client{
		config: config,
		parser: wal.NewParser(),
		stopCh: make(chan struct{}),
	}
}

// Connect establishes the replication connection.
func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		return errors.New("already connected")
	}

	conn, err := pgconn.Connect(ctx, c.config.ConnString)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	c.conn = conn
	return nil
}

// IdentifySystem returns information about the PostgreSQL system.
func (c *Client) IdentifySystem(ctx context.Context) (*pglogrepl.IdentifySystemResult, error) {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()

	if conn == nil {
		return nil, errors.New("not connected")
	}

	result, err := pglogrepl.IdentifySystem(ctx, conn)
	if err != nil {
		return nil, fmt.Errorf("identify system failed: %w", err)
	}

	return &result, nil
}

// CreateSlot creates a replication slot if it doesn't exist.
// Uses the pgoutput plugin for logical replication.
func (c *Client) CreateSlot(ctx context.Context) error {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()

	if conn == nil {
		return errors.New("not connected")
	}

	// Try to create the slot
	_, err := pglogrepl.CreateReplicationSlot(ctx, conn, c.config.SlotName, "pgoutput",
		pglogrepl.CreateReplicationSlotOptions{
			Mode: pglogrepl.LogicalReplication,
		})
	if err != nil {
		// Check if slot already exists (error code 42710 - duplicate_object)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42710" {
			// Slot already exists, that's fine
			return nil
		}
		return fmt.Errorf("failed to create replication slot: %w", err)
	}

	return nil
}

// DropSlot drops the replication slot.
func (c *Client) DropSlot(ctx context.Context) error {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()

	if conn == nil {
		return errors.New("not connected")
	}

	err := pglogrepl.DropReplicationSlot(ctx, conn, c.config.SlotName,
		pglogrepl.DropReplicationSlotOptions{})
	if err != nil {
		// Check if slot doesn't exist (error code 42704 - undefined_object)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42704" {
			// Slot doesn't exist, that's fine
			return nil
		}
		return fmt.Errorf("failed to drop replication slot: %w", err)
	}

	return nil
}

// GetCurrentLSN returns the current WAL position from the server.
func (c *Client) GetCurrentLSN(ctx context.Context) (pglogrepl.LSN, error) {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()

	if conn == nil {
		return 0, errors.New("not connected")
	}

	result, err := pglogrepl.IdentifySystem(ctx, conn)
	if err != nil {
		return 0, fmt.Errorf("failed to get current LSN: %w", err)
	}

	return result.XLogPos, nil
}

// Start begins streaming WAL changes.
// Messages are sent to the provided channel.
// This method blocks until Stop is called or an error occurs.
func (c *Client) Start(ctx context.Context, messages chan<- *wal.Message) error {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return errors.New("already streaming")
	}
	if c.conn == nil {
		c.mu.Unlock()
		return errors.New("not connected")
	}
	c.running = true
	c.stopCh = make(chan struct{})
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.running = false
		c.mu.Unlock()
	}()

	// Build plugin arguments for pgoutput
	pluginArgs := []string{
		"proto_version '1'",
		fmt.Sprintf("publication_names '%s'", c.config.Publication),
	}

	// Start replication
	err := pglogrepl.StartReplication(ctx, c.conn, c.config.SlotName, c.config.StartLSN,
		pglogrepl.StartReplicationOptions{
			PluginArgs: pluginArgs,
		})
	if err != nil {
		return fmt.Errorf("failed to start replication: %w", err)
	}

	// Set up a ticker for sending standby status updates
	standbyTicker := time.NewTicker(c.config.StandbyMessageTimeout)
	defer standbyTicker.Stop()

	// Message receive loop
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case <-c.stopCh:
			return nil

		case <-standbyTicker.C:
			// Send periodic standby status update
			if err := c.sendStandbyStatusUpdate(ctx); err != nil {
				return fmt.Errorf("failed to send standby status: %w", err)
			}

		default:
			// Set a deadline for receiving messages
			receiveCtx, cancel := context.WithDeadline(ctx, time.Now().Add(c.config.StandbyMessageTimeout))
			rawMsg, err := c.conn.ReceiveMessage(receiveCtx)
			cancel()

			if err != nil {
				if pgconn.Timeout(err) {
					// Timeout is normal - send standby status and continue
					if err := c.sendStandbyStatusUpdate(ctx); err != nil {
						return fmt.Errorf("failed to send standby status: %w", err)
					}
					continue
				}
				return fmt.Errorf("failed to receive message: %w", err)
			}

			if errMsg, ok := rawMsg.(*pgproto3.ErrorResponse); ok {
				return fmt.Errorf("received error from server: %s", errMsg.Message)
			}

			copyData, ok := rawMsg.(*pgproto3.CopyData)
			if !ok {
				continue
			}

			// Process the replication message
			switch copyData.Data[0] {
			case msgPrimaryKeepalive:
				pk, err := pglogrepl.ParsePrimaryKeepaliveMessage(copyData.Data[1:])
				if err != nil {
					return fmt.Errorf("failed to parse keepalive: %w", err)
				}

				// Update received LSN
				if pk.ServerWALEnd > c.receivedLSN {
					c.receivedLSN = pk.ServerWALEnd
				}

				// Reply if requested
				if pk.ReplyRequested {
					if err := c.sendStandbyStatusUpdate(ctx); err != nil {
						return fmt.Errorf("failed to reply to keepalive: %w", err)
					}
				}

			case msgXLogData:
				xld, err := pglogrepl.ParseXLogData(copyData.Data[1:])
				if err != nil {
					return fmt.Errorf("failed to parse xlog data: %w", err)
				}

				// Update received LSN
				if xld.WALStart > c.receivedLSN {
					c.receivedLSN = xld.WALStart
				}

				// Parse the pgoutput message using pglogrepl
				logicalMsg, err := pglogrepl.Parse(xld.WALData)
				if err != nil {
					return fmt.Errorf("failed to parse logical message: %w", err)
				}

				// Convert to our wal.Message type
				msg, err := c.parser.Parse(logicalMsg)
				if err != nil {
					return fmt.Errorf("failed to convert WAL message: %w", err)
				}

				// Set the LSN on the message
				if msg != nil {
					msg.LSN = xld.WALStart
					select {
					case messages <- msg:
					case <-ctx.Done():
						return ctx.Err()
					case <-c.stopCh:
						return nil
					}
				}
			}
		}
	}
}

// Stop stops streaming.
func (c *Client) Stop() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.running {
		return nil
	}

	close(c.stopCh)
	return nil
}

// Close closes the connection.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	err := c.conn.Close(context.Background())
	c.conn = nil
	return err
}

// AcknowledgeLSN confirms processing up to the given LSN.
func (c *Client) AcknowledgeLSN(lsn pglogrepl.LSN) error {
	c.mu.Lock()
	if lsn > c.flushedLSN {
		c.flushedLSN = lsn
	}
	if lsn > c.appliedLSN {
		c.appliedLSN = lsn
	}
	c.mu.Unlock()

	return c.sendStandbyStatusUpdate(context.Background())
}

// sendStandbyStatusUpdate sends a standby status update to the server.
func (c *Client) sendStandbyStatusUpdate(ctx context.Context) error {
	c.mu.RLock()
	conn := c.conn
	received := c.receivedLSN
	flushed := c.flushedLSN
	applied := c.appliedLSN
	c.mu.RUnlock()

	if conn == nil {
		return errors.New("not connected")
	}

	// PostgreSQL expects LSN+1 to indicate we've processed up to and including that LSN
	return pglogrepl.SendStandbyStatusUpdate(ctx, conn, pglogrepl.StandbyStatusUpdate{
		WALWritePosition: received + 1,
		WALFlushPosition: flushed + 1,
		WALApplyPosition: applied + 1,
		ClientTime:       time.Now(),
		ReplyRequested:   false,
	})
}

// IsRunning returns whether the client is currently streaming.
func (c *Client) IsRunning() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.running
}

// IsConnected returns whether the client is connected.
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.conn != nil
}

// GetReceivedLSN returns the last received LSN.
func (c *Client) GetReceivedLSN() pglogrepl.LSN {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.receivedLSN
}

// GetFlushedLSN returns the last flushed (acknowledged) LSN.
func (c *Client) GetFlushedLSN() pglogrepl.LSN {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.flushedLSN
}

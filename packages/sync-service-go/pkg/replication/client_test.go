package replication

import (
	"testing"
	"time"

	"github.com/jackc/pglogrepl"
	"github.com/stretchr/testify/assert"
)

func TestNewClient(t *testing.T) {
	t.Run("creates client with default timeout", func(t *testing.T) {
		config := ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "test_pub",
		}

		client := NewClient(config)

		assert.NotNil(t, client)
		assert.Equal(t, config.ConnString, client.config.ConnString)
		assert.Equal(t, config.SlotName, client.config.SlotName)
		assert.Equal(t, config.Publication, client.config.Publication)
		assert.Equal(t, 10*time.Second, client.config.StandbyMessageTimeout)
		assert.NotNil(t, client.parser)
		assert.False(t, client.running)
	})

	t.Run("creates client with custom timeout", func(t *testing.T) {
		config := ClientConfig{
			ConnString:            "postgres://localhost/test",
			SlotName:              "test_slot",
			Publication:           "test_pub",
			StandbyMessageTimeout: 30 * time.Second,
		}

		client := NewClient(config)

		assert.Equal(t, 30*time.Second, client.config.StandbyMessageTimeout)
	})

	t.Run("creates client with start LSN", func(t *testing.T) {
		config := ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "test_pub",
			StartLSN:    pglogrepl.LSN(0x16B3748),
		}

		client := NewClient(config)

		assert.Equal(t, pglogrepl.LSN(0x16B3748), client.config.StartLSN)
	})
}

func TestClientState(t *testing.T) {
	t.Run("IsConnected returns false when not connected", func(t *testing.T) {
		client := NewClient(ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "test_pub",
		})

		assert.False(t, client.IsConnected())
	})

	t.Run("IsRunning returns false when not running", func(t *testing.T) {
		client := NewClient(ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "test_pub",
		})

		assert.False(t, client.IsRunning())
	})

	t.Run("GetReceivedLSN returns zero initially", func(t *testing.T) {
		client := NewClient(ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "test_pub",
		})

		assert.Equal(t, pglogrepl.LSN(0), client.GetReceivedLSN())
	})

	t.Run("GetFlushedLSN returns zero initially", func(t *testing.T) {
		client := NewClient(ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "test_pub",
		})

		assert.Equal(t, pglogrepl.LSN(0), client.GetFlushedLSN())
	})
}

func TestClientStopWhenNotRunning(t *testing.T) {
	client := NewClient(ClientConfig{
		ConnString:  "postgres://localhost/test",
		SlotName:    "test_slot",
		Publication: "test_pub",
	})

	// Stop should not error when not running
	err := client.Stop()
	assert.NoError(t, err)
}

func TestClientCloseWhenNotConnected(t *testing.T) {
	client := NewClient(ClientConfig{
		ConnString:  "postgres://localhost/test",
		SlotName:    "test_slot",
		Publication: "test_pub",
	})

	// Close should not error when not connected
	err := client.Close()
	assert.NoError(t, err)
}

func TestClientConfigValidation(t *testing.T) {
	t.Run("empty slot name", func(t *testing.T) {
		config := ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "",
			Publication: "test_pub",
		}

		client := NewClient(config)

		// Client should still be created - validation happens at Connect/CreateSlot time
		assert.NotNil(t, client)
		assert.Equal(t, "", client.config.SlotName)
	})

	t.Run("empty publication name", func(t *testing.T) {
		config := ClientConfig{
			ConnString:  "postgres://localhost/test",
			SlotName:    "test_slot",
			Publication: "",
		}

		client := NewClient(config)

		// Client should still be created - validation happens at Start time
		assert.NotNil(t, client)
		assert.Equal(t, "", client.config.Publication)
	})
}

func TestClientConcurrentStateAccess(t *testing.T) {
	client := NewClient(ClientConfig{
		ConnString:  "postgres://localhost/test",
		SlotName:    "test_slot",
		Publication: "test_pub",
	})

	// Test concurrent access to state methods
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			client.IsConnected()
			client.IsRunning()
			client.GetReceivedLSN()
			client.GetFlushedLSN()
		}
		close(done)
	}()

	for i := 0; i < 100; i++ {
		client.IsConnected()
		client.IsRunning()
		client.GetReceivedLSN()
		client.GetFlushedLSN()
	}

	<-done
}

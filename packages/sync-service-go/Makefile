.PHONY: all build test lint fmt vet clean

GO := go
GOFLAGS := -v

# Fix for macOS strchrnul issue with pg_query_go
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
export CGO_CFLAGS=-Wno-nullability-completeness
endif

all: fmt vet lint test build

build:
	$(GO) build $(GOFLAGS) ./...

build-binary:
	$(GO) build $(GOFLAGS) -o electric ./cmd/electric

# Build using Docker (works on all platforms, recommended for macOS)
build-docker:
	docker run --rm -v $(PWD):/app -w /app golang:1.21 go build -o electric ./cmd/electric

test:
	$(GO) test $(GOFLAGS) -race -cover ./...

test-short:
	$(GO) test -short ./...

lint:
	@which golangci-lint > /dev/null || (echo "Installing golangci-lint..." && go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)
	golangci-lint run ./...

fmt:
	$(GO) fmt ./...
	@which goimports > /dev/null || go install golang.org/x/tools/cmd/goimports@latest
	goimports -w -local github.com/electric-sql/electric .

vet:
	$(GO) vet ./...

clean:
	$(GO) clean
	rm -f coverage.out

coverage:
	$(GO) test -coverprofile=coverage.out ./...
	$(GO) tool cover -html=coverage.out

tidy:
	$(GO) mod tidy

check: fmt vet test

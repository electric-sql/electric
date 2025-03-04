FROM electricsql/electric:latest

# Install test dependencies
RUN apt-get update && apt-get install -y httpie postgresql-client

# Copy test files
COPY test /opt/antithesis/test
